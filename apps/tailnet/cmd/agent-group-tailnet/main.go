package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

type event struct {
	Type      string   `json:"type"`
	State     string   `json:"state,omitempty"`
	URL       string   `json:"url,omitempty"`
	AuthURL   string   `json:"authUrl,omitempty"`
	Transport string   `json:"transport,omitempty"`
	IPv4      string   `json:"ipv4,omitempty"`
	DNSName   string   `json:"dnsName,omitempty"`
	Health    []string `json:"health,omitempty"`
	Message   string   `json:"message,omitempty"`
}

type emitter struct {
	mu   sync.Mutex
	last string
}

type loginState struct {
	mu      sync.RWMutex
	authURL string
}

func (s *loginState) remember(authURL string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if authURL != "" {
		s.authURL = authURL
	}
	return s.authURL
}

func (e *emitter) emit(next event) {
	encoded, err := json.Marshal(next)
	if err != nil {
		return
	}
	line := string(encoded)
	e.mu.Lock()
	defer e.mu.Unlock()
	if line == e.last {
		return
	}
	e.last = line
	fmt.Println(line)
}

var loginURLPattern = regexp.MustCompile(`https://login\.tailscale\.com/a/[A-Za-z0-9_-]+`)

func main() {
	stateDir := flag.String("state-dir", "", "persistent tsnet state directory")
	hostname := flag.String("hostname", "agent-group", "tailnet device hostname")
	backendURL := flag.String("backend-url", "", "loopback Agent Group backend URL")
	flag.Parse()

	if *stateDir == "" || *backendURL == "" {
		log.Fatal("--state-dir and --backend-url are required")
	}
	target, err := url.Parse(*backendURL)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" {
		log.Fatal("--backend-url must be an http://127.0.0.1 URL")
	}
	if err := os.MkdirAll(*stateDir, 0700); err != nil {
		log.Fatal(err)
	}
	if err := os.Chmod(*stateDir, 0700); err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	emit := &emitter{}
	login := &loginState{}
	srv := &tsnet.Server{
		Dir:      *stateDir,
		Hostname: normalizeHostname(*hostname),
		UserLogf: func(format string, args ...any) {
			message := fmt.Sprintf(format, args...)
			if authURL := loginURLPattern.FindString(message); authURL != "" {
				login.remember(authURL)
				emit.emit(event{Type: "status", State: "needs-login", AuthURL: authURL})
			}
		},
	}
	defer srv.Close()

	emit.emit(event{Type: "status", State: "starting"})
	if err := srv.Start(); err != nil {
		emit.emit(event{Type: "error", State: "error", Message: err.Error()})
		os.Exit(1)
	}
	localClient, err := srv.LocalClient()
	if err != nil {
		emit.emit(event{Type: "error", State: "error", Message: err.Error()})
		os.Exit(1)
	}

	status, err := waitUntilRunning(ctx, localClient.Status, emit, login)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			emit.emit(event{Type: "error", State: "error", Message: err.Error()})
			os.Exit(1)
		}
		return
	}

	listener, publicURL, transport, listenError := listen(srv, status)
	if listener == nil {
		emit.emit(event{Type: "error", State: "error", Message: listenError})
		os.Exit(1)
	}
	defer listener.Close()

	ready := event{
		Type:      "status",
		State:     "ready",
		URL:       publicURL,
		Transport: transport,
		IPv4:      firstIPv4(status),
		DNSName:   dnsName(status),
		Health:    status.Health,
	}
	emit.emit(ready)

	proxy := newReverseProxy(target, publicURL, transport == "https")
	httpServer := &http.Server{
		Handler:           proxy,
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- httpServer.Serve(listener) }()

	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = httpServer.Shutdown(shutdownCtx)
	case err := <-serveDone:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			emit.emit(event{Type: "error", State: "error", Message: err.Error()})
			os.Exit(1)
		}
	}
}

func waitUntilRunning(
	ctx context.Context,
	statusFn func(context.Context) (*ipnstate.Status, error),
	emit *emitter,
	login *loginState,
) (*ipnstate.Status, error) {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := statusFn(ctx)
		if err == nil {
			switch status.BackendState {
			case "Running":
				return status, nil
			case "NeedsMachineAuth":
				emit.emit(event{Type: "status", State: "needs-approval", Health: status.Health})
			case "NeedsLogin":
				emit.emit(event{
					Type:    "status",
					State:   "needs-login",
					AuthURL: login.remember(status.AuthURL),
					Health:  status.Health,
				})
			default:
				emit.emit(event{Type: "status", State: "starting", Health: status.Health})
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func listen(srv *tsnet.Server, status *ipnstate.Status) (net.Listener, string, string, string) {
	domains := srv.CertDomains()
	if len(domains) > 0 {
		listener, err := srv.ListenTLS("tcp", ":443")
		if err == nil {
			return listener, "https://" + strings.TrimSuffix(domains[0], "."), "https", ""
		}
	}

	listener, err := srv.Listen("tcp", ":80")
	if err != nil {
		return nil, "", "", err.Error()
	}
	host := dnsName(status)
	if host == "" {
		host = firstIPv4(status)
	}
	if host == "" {
		listener.Close()
		return nil, "", "", "Tailnet is connected but no reachable address is available."
	}
	return listener, "http://" + host, "http", ""
}

func newReverseProxy(target *url.URL, publicURL string, secure bool) http.Handler {
	publicEndpoint, err := url.Parse(publicURL)
	if err != nil {
		panic("invalid public URL")
	}
	expectedScheme := strings.ToLower(publicEndpoint.Scheme)
	expectedHost := strings.ToLower(publicEndpoint.Host)
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalHost := request.Host
		forwardedScheme := "http"
		if secure {
			forwardedScheme = "https"
		}
		originalDirector(request)
		request.Host = target.Host
		request.Header.Del("Forwarded")
		request.Header.Del("X-Forwarded-For")
		request.Header.Del("X-Forwarded-Host")
		request.Header.Del("X-Forwarded-Proto")
		request.Header.Set("X-Forwarded-Host", originalHost)
		request.Header.Set("X-Forwarded-Proto", forwardedScheme)
		if request.Header.Get("Origin") != "" {
			request.Header.Set("Origin", forwardedScheme+"://"+target.Host)
		}
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Set("X-Content-Type-Options", "nosniff")
		response.Header.Set("Referrer-Policy", "same-origin")
		if secure {
			response.Header.Set("Strict-Transport-Security", "max-age=31536000")
			cookies := response.Header.Values("Set-Cookie")
			response.Header.Del("Set-Cookie")
			for _, cookie := range cookies {
				if !strings.Contains(strings.ToLower(cookie), "; secure") {
					cookie += "; Secure"
				}
				response.Header.Add("Set-Cookie", cookie)
			}
		}
		return nil
	}
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(writer, "Agent Group is temporarily unavailable.", http.StatusBadGateway)
	}
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.ToLower(request.Host) != expectedHost {
			http.Error(writer, "Invalid Tailnet host.", http.StatusForbidden)
			return
		}
		if origin := request.Header.Get("Origin"); origin != "" {
			parsedOrigin, parseErr := url.Parse(origin)
			if parseErr != nil || strings.ToLower(parsedOrigin.Scheme) != expectedScheme || strings.ToLower(parsedOrigin.Host) != expectedHost {
				http.Error(writer, "Invalid Tailnet origin.", http.StatusForbidden)
				return
			}
		}
		proxy.ServeHTTP(writer, request)
	})
}

func normalizeHostname(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, char := range value {
		valid := char >= 'a' && char <= 'z' || char >= '0' && char <= '9'
		if valid {
			builder.WriteRune(char)
			lastDash = false
		} else if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(strings.TrimSpace(builder.String()), "-")
}

func dnsName(status *ipnstate.Status) string {
	if status.Self == nil {
		return ""
	}
	return strings.TrimSuffix(status.Self.DNSName, ".")
}

func firstIPv4(status *ipnstate.Status) string {
	for _, address := range status.TailscaleIPs {
		if address.Is4() {
			return address.String()
		}
	}
	return ""
}
