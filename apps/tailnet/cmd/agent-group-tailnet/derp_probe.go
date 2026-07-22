package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"tailscale.com/tailcfg"
)

const derpProbeTimeout = 1500 * time.Millisecond

func probeDERPHTTPS(
	ctx context.Context,
	node *tailcfg.DERPNode,
	proxy requestProxy,
) (time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, derpProbeTimeout)
	defer cancel()

	port := node.DERPPort
	if port == 0 {
		port = 443
	}
	requestHost := node.HostName
	if port != 443 {
		requestHost = net.JoinHostPort(requestHost, strconv.Itoa(port))
	}
	tlsName := node.CertName
	if tlsName == "" {
		tlsName = node.HostName
	}
	transport := &http.Transport{
		Proxy:             proxy,
		DisableKeepAlives: true,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: tlsName,
		},
	}
	if proxy == nil {
		dialHost := node.IPv4
		if dialHost == "" || dialHost == "none" {
			dialHost = node.HostName
		}
		dialer := &net.Dialer{Timeout: derpProbeTimeout}
		dialAddress := net.JoinHostPort(dialHost, strconv.Itoa(port))
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", dialAddress)
		}
	}
	defer transport.CloseIdleConnections()

	requestURL := "https://" + requestHost + "/derp/latency-check"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return 0, err
	}
	started := time.Now()
	response, err := (&http.Client{Transport: transport}).Do(request)
	latency := time.Since(started)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("DERP latency probe returned %s", response.Status)
	}
	if _, err := io.Copy(io.Discard, io.LimitReader(response.Body, 8<<10)); err != nil {
		return 0, err
	}
	return latency, nil
}
