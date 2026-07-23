package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
)

type fakeDERPRoutingClient struct {
	derpMap *tailcfg.DERPMap
	status  *ipnstate.Status
}

func (f *fakeDERPRoutingClient) CurrentDERPMap(context.Context) (*tailcfg.DERPMap, error) {
	return f.derpMap, nil
}

func TestPreferredDERPRegionKeepsAppliedPreferenceAfterSwitch(t *testing.T) {
	route := derpRoute{regionID: 20, proxyLatency: 120 * time.Millisecond}
	if got := preferredDERPRegion(route, true, route, true, 20); got != 20 {
		t.Fatalf("expected applied preference to remain stable, got %d", got)
	}
	if got := preferredDERPRegion(route, true, route, true, 0); got != 0 {
		t.Fatalf("native best region must not become unnecessarily forced, got %d", got)
	}
}

func (f *fakeDERPRoutingClient) Status(context.Context) (*ipnstate.Status, error) {
	return f.status, nil
}

func TestAdaptiveDERPProxyBypassesOnlyVerifiedHosts(t *testing.T) {
	upstream, _ := url.Parse("http://127.0.0.1:7890")
	proxy := &adaptiveDERPProxy{
		base:        func(*http.Request) (*url.URL, error) { return upstream, nil },
		directHosts: make(map[string]struct{}),
	}
	if !proxy.setRouting([]string{"DERP20.TAILSCALE.COM."}, 20) {
		t.Fatal("expected the direct host set to change")
	}

	directURL, _ := url.Parse("https://derp20.tailscale.com/derp")
	got, err := proxy.proxyForURL(directURL)
	if err != nil || got != nil {
		t.Fatalf("expected verified DERP host to be direct, got proxy=%v err=%v", got, err)
	}
	controlURL, _ := url.Parse("https://controlplane.tailscale.com/")
	got, err = proxy.proxyForURL(controlURL)
	if err != nil || got == nil || got.String() != upstream.String() {
		t.Fatalf("expected control traffic to keep upstream proxy, got proxy=%v err=%v", got, err)
	}
}

func TestOptimizeDERPRoutingSelectsOnlyMeaningfullyFasterDirectPaths(t *testing.T) {
	client := &fakeDERPRoutingClient{derpMap: testDERPMap(), status: relayStatus("sfo")}
	upstream, _ := url.Parse("http://127.0.0.1:7890")
	proxy := &adaptiveDERPProxy{
		base:        func(*http.Request) (*url.URL, error) { return upstream, nil },
		directHosts: make(map[string]struct{}),
	}
	direct := map[string]time.Duration{
		"derp-hkg.example": 40 * time.Millisecond,
		"derp-tyo.example": 70 * time.Millisecond,
		"derp-sfo.example": 180 * time.Millisecond,
	}
	proxied := map[string]time.Duration{
		"derp-hkg.example": 210 * time.Millisecond,
		"derp-tyo.example": 160 * time.Millisecond,
		"derp-sfo.example": 190 * time.Millisecond,
	}
	probe := func(
		_ context.Context,
		node *tailcfg.DERPNode,
		viaProxy requestProxy,
	) (time.Duration, error) {
		if node.HostName == "derp-hkg.example" && node.DERPPort != 444 {
			return 0, errors.New("probe did not receive live DERP node metadata")
		}
		if viaProxy == nil {
			return direct[node.HostName], nil
		}
		return proxied[node.HostName], nil
	}

	result, err := optimizeDERPRouting(context.Background(), client, proxy, probe)
	if err != nil {
		t.Fatal(err)
	}
	if !result.changed || len(result.routes) != 2 {
		t.Fatalf("expected two new direct routes, got changed=%v routes=%v", result.changed, result.routes)
	}
	if result.routes[0].regionCode != "hkg" || result.routes[1].regionCode != "tyo" {
		t.Fatalf("unexpected selected routes: %v", result.routes)
	}
	if result.preferredRegion != 20 {
		t.Fatalf("expected hkg to replace slower current sfo relay, got region %d", result.preferredRegion)
	}
	if got := result.message(); got != "Switching relay to hkg (40 ms direct; current sfo 190 ms)." {
		t.Fatalf("unexpected route message %q", got)
	}
}

func TestOptimizeDERPRoutingFallsBackWhenDirectPathLosesAdvantage(t *testing.T) {
	client := &fakeDERPRoutingClient{derpMap: testDERPMap(), status: relayStatus("hkg")}
	upstream, _ := url.Parse("http://127.0.0.1:7890")
	proxy := &adaptiveDERPProxy{
		base:        func(*http.Request) (*url.URL, error) { return upstream, nil },
		directHosts: map[string]struct{}{"derp-hkg.example": {}},
	}
	probe := func(
		_ context.Context,
		node *tailcfg.DERPNode,
		viaProxy requestProxy,
	) (time.Duration, error) {
		if node.HostName != "derp-hkg.example" {
			return 0, errors.New("unreachable")
		}
		if viaProxy == nil {
			return 150 * time.Millisecond, nil
		}
		return 160 * time.Millisecond, nil
	}

	result, err := optimizeDERPRouting(context.Background(), client, proxy, probe)
	if err != nil {
		t.Fatal(err)
	}
	if !result.changed || len(result.routes) != 0 {
		t.Fatalf("expected proxy fallback, got changed=%v routes=%v", result.changed, result.routes)
	}
	target, _ := url.Parse("https://derp-hkg.example/derp")
	got, err := proxy.proxyForURL(target)
	if err != nil || got == nil {
		t.Fatalf("expected failed direct route to return to proxy, got proxy=%v err=%v", got, err)
	}
}

func TestOptimizeDERPRoutingCorrectsRelayMisselectionWithoutForcingDirect(t *testing.T) {
	client := &fakeDERPRoutingClient{derpMap: testDERPMap(), status: relayStatus("sfo")}
	upstream, _ := url.Parse("http://127.0.0.1:7890")
	proxy := &adaptiveDERPProxy{
		base:        func(*http.Request) (*url.URL, error) { return upstream, nil },
		directHosts: make(map[string]struct{}),
	}
	direct := map[string]time.Duration{
		"derp-hkg.example": 305 * time.Millisecond,
		"derp-tyo.example": 810 * time.Millisecond,
		"derp-sfo.example": 725 * time.Millisecond,
	}
	proxied := map[string]time.Duration{
		"derp-hkg.example": 314 * time.Millisecond,
		"derp-tyo.example": 840 * time.Millisecond,
		"derp-sfo.example": 653 * time.Millisecond,
	}
	probe := func(
		_ context.Context,
		node *tailcfg.DERPNode,
		viaProxy requestProxy,
	) (time.Duration, error) {
		if viaProxy == nil {
			return direct[node.HostName], nil
		}
		return proxied[node.HostName], nil
	}

	result, err := optimizeDERPRouting(context.Background(), client, proxy, probe)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.routes) != 0 {
		t.Fatalf("small direct gains must keep the reliable proxy path, got %v", result.routes)
	}
	if !result.changed || result.preferredRegion != 20 || result.best.regionCode != "hkg" {
		t.Fatalf("expected hkg relay preference, got %+v", result)
	}
	if got := result.message(); got != "Switching relay to hkg (314 ms through the system proxy; current sfo 653 ms)." {
		t.Fatalf("unexpected route message %q", got)
	}
}

func testDERPMap() *tailcfg.DERPMap {
	return &tailcfg.DERPMap{Regions: map[int]*tailcfg.DERPRegion{
		20: {
			RegionID:   20,
			RegionCode: "hkg",
			Nodes: []*tailcfg.DERPNode{{
				Name: "20a", RegionID: 20, HostName: "derp-hkg.example", DERPPort: 444,
			}},
		},
		7: {
			RegionID:   7,
			RegionCode: "tyo",
			Nodes:      []*tailcfg.DERPNode{{Name: "7a", RegionID: 7, HostName: "derp-tyo.example"}},
		},
		2: {
			RegionID:   2,
			RegionCode: "sfo",
			Nodes:      []*tailcfg.DERPNode{{Name: "2a", RegionID: 2, HostName: "derp-sfo.example"}},
		},
	}}
}

func relayStatus(regionCode string) *ipnstate.Status {
	return &ipnstate.Status{Self: &ipnstate.PeerStatus{Relay: regionCode}}
}
