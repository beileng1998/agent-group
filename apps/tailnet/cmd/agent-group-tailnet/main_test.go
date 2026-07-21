package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestLoginStateKeepsAuthURLAcrossEmptyStatus(t *testing.T) {
	state := &loginState{}
	want := "https://login.tailscale.com/a/example"
	if got := state.remember(want); got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
	if got := state.remember(""); got != want {
		t.Fatalf("expected empty updates to preserve %q, got %q", want, got)
	}
}

func TestReverseProxyAcceptsOnlyAdvertisedTailnetOrigin(t *testing.T) {
	var backendOrigin string
	var forwardedProto string
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		backendOrigin = request.Header.Get("Origin")
		forwardedProto = request.Header.Get("X-Forwarded-Proto")
		writer.Header().Add("Set-Cookie", "session=secret; HttpOnly; Path=/")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	handler := newReverseProxy(target, "https://agent-group.example.ts.net", true)
	request := httptest.NewRequest(http.MethodGet, "https://agent-group.example.ts.net/api/auth/session", nil)
	request.Host = "agent-group.example.ts.net"
	request.Header.Set("Origin", "https://agent-group.example.ts.net")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected %d, got %d", http.StatusNoContent, response.Code)
	}
	if backendOrigin != "https://"+target.Host {
		t.Fatalf("unexpected rewritten origin %q", backendOrigin)
	}
	if forwardedProto != "https" {
		t.Fatalf("unexpected forwarded protocol %q", forwardedProto)
	}
	if cookie := response.Header().Get("Set-Cookie"); !strings.Contains(cookie, "; Secure") {
		t.Fatalf("expected Secure cookie, got %q", cookie)
	}
}

func TestReverseProxyForwardsSecureWebSockets(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Origin"); got != "https://"+request.Host {
			t.Errorf("unexpected backend websocket origin %q", got)
		}
		if got := request.Header.Get("X-Forwarded-Proto"); got != "https" {
			t.Errorf("unexpected forwarded websocket protocol %q", got)
		}
		if got := request.URL.Query().Get("wsToken"); got != "signed-websocket-token" {
			t.Errorf("unexpected backend websocket token %q", got)
		}
		if got := request.Header.Get("Cookie"); got != "session=cookie-token" {
			t.Errorf("unexpected backend websocket cookie %q", got)
		}
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("accept backend websocket: %v", err)
			return
		}
		defer connection.CloseNow()
		messageType, message, err := connection.Read(request.Context())
		if err != nil {
			t.Errorf("read backend websocket: %v", err)
			return
		}
		if err := connection.Write(request.Context(), messageType, message); err != nil {
			t.Errorf("write backend websocket: %v", err)
		}
	}))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	var handler http.Handler
	frontend := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		handler.ServeHTTP(writer, request)
	}))
	defer frontend.Close()
	handler = newReverseProxy(target, frontend.URL, true)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	websocketURL := "wss" + strings.TrimPrefix(frontend.URL, "https") + "?wsToken=signed-websocket-token"
	connection, _, err := websocket.Dial(ctx, websocketURL, &websocket.DialOptions{
		HTTPClient: frontend.Client(),
		HTTPHeader: http.Header{
			"Cookie": []string{"session=cookie-token"},
			"Origin": []string{frontend.URL},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err := connection.Write(ctx, websocket.MessageText, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	_, message, err := connection.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(message) != "hello" {
		t.Fatalf("expected echoed websocket message, got %q", message)
	}
}

func TestReverseProxyRejectsHostAndOriginConfusion(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	handler := newReverseProxy(target, "https://agent-group.example.ts.net", true)

	tests := []struct {
		name   string
		host   string
		origin string
	}{
		{name: "wrong host", host: "attacker.example", origin: "https://agent-group.example.ts.net"},
		{name: "wrong origin", host: "agent-group.example.ts.net", origin: "https://attacker.example"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "https://agent-group.example.ts.net/", nil)
			request.Host = test.host
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("expected %d, got %d", http.StatusForbidden, response.Code)
			}
		})
	}
}
