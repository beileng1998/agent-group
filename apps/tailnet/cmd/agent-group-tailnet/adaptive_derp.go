package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/tshttpproxy"
	"tailscale.com/tailcfg"
)

const (
	derpRefreshInterval       = 10 * time.Minute
	maxDirectDERPRegions      = 2
	maxComparedDERPRegions    = 3
	minimumDERPLatencyGain    = 25 * time.Millisecond
	minimumDERPLatencyPercent = 85
)

type requestProxy func(*http.Request) (*url.URL, error)

// adaptiveDERPProxy keeps control traffic on the configured system proxy while
// allowing only verified DERP hosts to use the machine's direct route.
type adaptiveDERPProxy struct {
	mu              sync.RWMutex
	base            requestProxy
	directHosts     map[string]struct{}
	preferredRegion int
}

func installAdaptiveDERPProxy() (*adaptiveDERPProxy, error) {
	base := requestProxy(http.ProxyFromEnvironment)
	controlURL, _ := url.Parse("https://controlplane.tailscale.com/")
	upstream, err := base(&http.Request{URL: controlURL})
	if err != nil {
		return nil, err
	}
	if upstream == nil {
		return nil, nil
	}

	proxy := &adaptiveDERPProxy{base: base, directHosts: make(map[string]struct{})}
	if err := tshttpproxy.SetProxyFunc(proxy.proxyForURL); err != nil {
		return nil, err
	}
	return proxy, nil
}

func (p *adaptiveDERPProxy) proxyForURL(target *url.URL) (*url.URL, error) {
	host := normalizeDERPHost(target.Hostname())
	p.mu.RLock()
	_, direct := p.directHosts[host]
	p.mu.RUnlock()
	if direct {
		return nil, nil
	}
	return p.base(&http.Request{URL: target})
}

func (p *adaptiveDERPProxy) setRouting(hosts []string, preferredRegion int) bool {
	next := make(map[string]struct{}, len(hosts))
	for _, host := range hosts {
		if normalized := normalizeDERPHost(host); normalized != "" {
			next[normalized] = struct{}{}
		}
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if equalHostSets(p.directHosts, next) && p.preferredRegion == preferredRegion {
		return false
	}
	p.directHosts = next
	p.preferredRegion = preferredRegion
	return true
}

func (p *adaptiveDERPProxy) currentPreferredRegion() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.preferredRegion
}

func equalHostSets(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for host := range left {
		if _, ok := right[host]; !ok {
			return false
		}
	}
	return true
}

func normalizeDERPHost(host string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
}

type derpRoutingClient interface {
	CurrentDERPMap(context.Context) (*tailcfg.DERPMap, error)
	DebugAction(context.Context, string) error
	DebugActionBody(context.Context, string, io.Reader) error
	Status(context.Context) (*ipnstate.Status, error)
}

type derpProbe func(context.Context, *tailcfg.DERPNode, requestProxy) (time.Duration, error)

type derpRoute struct {
	regionID       int
	regionCode     string
	host           string
	node           *tailcfg.DERPNode
	directLatency  time.Duration
	directFailed   bool
	proxyLatency   time.Duration
	proxyFailed    bool
	directSelected bool
}

type derpRoutingResult struct {
	routes            []derpRoute
	best              derpRoute
	hasBest           bool
	currentRegionCode string
	currentLatency    time.Duration
	currentReachable  bool
	preferredRegion   int
	changed           bool
}

func (r derpRoutingResult) message() string {
	if !r.hasBest {
		return "Tailnet relays use the system proxy fallback."
	}
	latency, _ := r.best.plannedLatency()
	path := "through the system proxy"
	if r.best.directSelected {
		path = "direct"
	}
	if r.preferredRegion != 0 && r.currentRegionCode != "" && r.currentReachable {
		return fmt.Sprintf(
			"Adaptive relay preference: %s (%d ms %s; current %s %d ms).",
			r.best.regionCode,
			latency.Milliseconds(),
			path,
			r.currentRegionCode,
			r.currentLatency.Milliseconds(),
		)
	}
	return fmt.Sprintf(
		"Measured relay route: %s (%d ms %s).",
		r.best.regionCode,
		latency.Milliseconds(),
		path,
	)
}

func (r derpRoute) plannedLatency() (time.Duration, bool) {
	if r.directSelected && !r.directFailed {
		return r.directLatency, true
	}
	if !r.proxyFailed {
		return r.proxyLatency, true
	}
	return 0, false
}

func optimizeDERPRouting(
	ctx context.Context,
	client derpRoutingClient,
	proxy *adaptiveDERPProxy,
	probe derpProbe,
) (derpRoutingResult, error) {
	derpMap, err := client.CurrentDERPMap(ctx)
	if err != nil {
		return derpRoutingResult{}, err
	}
	candidates := directDERPCandidates(derpMap)
	if len(candidates) == 0 {
		return derpRoutingResult{}, errors.New("DERP map has no probeable regions")
	}

	directRoutes := probeDERPCandidates(ctx, candidates, nil, probe)
	sort.Slice(directRoutes, func(i, j int) bool {
		return directRoutes[i].directLatency < directRoutes[j].directLatency
	})
	compared := append([]derpRoute(nil), directRoutes...)
	if len(compared) > maxComparedDERPRegions {
		compared = compared[:maxComparedDERPRegions]
	}
	status, _ := client.Status(ctx)
	currentRegionCode := currentDERPRegionCode(status)
	compared = appendCurrentDERPRoute(compared, directRoutes, candidates, currentRegionCode)
	compared = probeProxyRoutes(ctx, compared, proxy.base, probe)

	routes := make([]derpRoute, 0, maxDirectDERPRegions)
	for _, requireFailedProxy := range []bool{true, false} {
		for index := range compared {
			route := &compared[index]
			if route.directFailed || route.directSelected || route.proxyFailed != requireFailedProxy {
				continue
			}
			if !route.proxyFailed && !meaningfullyFaster(route.directLatency, route.proxyLatency) {
				continue
			}
			route.directSelected = true
			routes = append(routes, *route)
			if len(routes) == maxDirectDERPRegions {
				break
			}
		}
		if len(routes) == maxDirectDERPRegions {
			break
		}
	}
	best, hasBest := bestPlannedDERPRoute(compared)
	current, hasCurrent := findDERPRoute(compared, currentRegionCode)
	currentLatency, currentReachable := current.plannedLatency()
	preferredRegion := preferredDERPRegion(
		best,
		hasBest,
		current,
		hasCurrent && currentReachable,
		proxy.currentPreferredRegion(),
	)
	if currentRegionCode == "" {
		preferredRegion = proxy.currentPreferredRegion()
	}
	hosts := make([]string, 0, len(routes))
	for _, route := range routes {
		hosts = append(hosts, route.host)
	}
	return derpRoutingResult{
		routes:            routes,
		best:              best,
		hasBest:           hasBest,
		currentRegionCode: currentRegionCode,
		currentLatency:    currentLatency,
		currentReachable:  hasCurrent && currentReachable,
		preferredRegion:   preferredRegion,
		changed:           proxy.setRouting(hosts, preferredRegion),
	}, nil
}

func currentDERPRegionCode(status *ipnstate.Status) string {
	if status == nil || status.Self == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(status.Self.Relay))
}

func appendCurrentDERPRoute(
	compared, direct, candidates []derpRoute,
	currentRegionCode string,
) []derpRoute {
	if currentRegionCode == "" {
		return compared
	}
	if _, ok := findDERPRoute(compared, currentRegionCode); ok {
		return compared
	}
	if route, ok := findDERPRoute(direct, currentRegionCode); ok {
		return append(compared, route)
	}
	if route, ok := findDERPRoute(candidates, currentRegionCode); ok {
		route.directFailed = true
		return append(compared, route)
	}
	return compared
}

func findDERPRoute(routes []derpRoute, regionCode string) (derpRoute, bool) {
	for _, route := range routes {
		if route.regionCode == regionCode {
			return route, true
		}
	}
	return derpRoute{}, false
}

func bestPlannedDERPRoute(routes []derpRoute) (derpRoute, bool) {
	var best derpRoute
	bestLatency := time.Duration(0)
	found := false
	for _, route := range routes {
		latency, reachable := route.plannedLatency()
		if !reachable || found && latency >= bestLatency {
			continue
		}
		best, bestLatency, found = route, latency, true
	}
	return best, found
}

func preferredDERPRegion(
	best derpRoute,
	hasBest bool,
	current derpRoute,
	currentReachable bool,
	previous int,
) int {
	if !hasBest {
		return 0
	}
	if currentReachable && current.regionID == best.regionID {
		if previous == best.regionID {
			return previous
		}
		return 0
	}
	bestLatency, _ := best.plannedLatency()
	if !currentReachable {
		return best.regionID
	}
	currentLatency, _ := current.plannedLatency()
	if meaningfullyFaster(bestLatency, currentLatency) {
		return best.regionID
	}
	return 0
}

func directDERPCandidates(derpMap *tailcfg.DERPMap) []derpRoute {
	if derpMap == nil {
		return nil
	}
	result := make([]derpRoute, 0, len(derpMap.Regions))
	for _, regionID := range derpMap.RegionIDs() {
		region := derpMap.Regions[regionID]
		if region == nil || region.Avoid || region.NoMeasureNoHome {
			continue
		}
		for _, node := range region.Nodes {
			if !probeableDERPNode(node) {
				continue
			}
			result = append(result, derpRoute{
				regionID:   regionID,
				regionCode: region.RegionCode,
				host:       node.HostName,
				node:       node,
			})
			break
		}
	}
	return result
}

func probeableDERPNode(node *tailcfg.DERPNode) bool {
	return node != nil && node.HostName != "" && !node.STUNOnly && !node.InsecureForTests &&
		!strings.HasPrefix(node.CertName, "sha256-raw:")
}

func probeDERPCandidates(
	ctx context.Context,
	candidates []derpRoute,
	proxy requestProxy,
	probe derpProbe,
) []derpRoute {
	type probeResult struct {
		route   derpRoute
		latency time.Duration
		err     error
	}
	results := make(chan probeResult, len(candidates))
	var wait sync.WaitGroup
	for _, candidate := range candidates {
		candidate := candidate
		wait.Add(1)
		go func() {
			defer wait.Done()
			latency, err := probe(ctx, candidate.node, proxy)
			results <- probeResult{route: candidate, latency: latency, err: err}
		}()
	}
	wait.Wait()
	close(results)

	successful := make([]derpRoute, 0, len(candidates))
	for result := range results {
		if result.err != nil {
			continue
		}
		result.route.directLatency = result.latency
		successful = append(successful, result.route)
	}
	return successful
}

func probeProxyRoutes(
	ctx context.Context,
	routes []derpRoute,
	proxy requestProxy,
	probe derpProbe,
) []derpRoute {
	type probeResult struct {
		index   int
		latency time.Duration
		err     error
	}
	results := make(chan probeResult, len(routes))
	var wait sync.WaitGroup
	for index, route := range routes {
		index, route := index, route
		wait.Add(1)
		go func() {
			defer wait.Done()
			latency, err := probe(ctx, route.node, proxy)
			results <- probeResult{index: index, latency: latency, err: err}
		}()
	}
	wait.Wait()
	close(results)

	for result := range results {
		routes[result.index].proxyLatency = result.latency
		routes[result.index].proxyFailed = result.err != nil
	}
	return routes
}

func meaningfullyFaster(direct, proxied time.Duration) bool {
	return direct+minimumDERPLatencyGain < proxied &&
		direct*100 <= proxied*minimumDERPLatencyPercent
}

func refreshTailnetRoutes(
	ctx context.Context,
	client derpRoutingClient,
	preferredRegion int,
) error {
	// Tailscale v1.98 exposes preferred-DERP override through this local action.
	// Keep it isolated here so a future API change degrades to native selection.
	actionCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	forceErr := client.DebugActionBody(
		actionCtx,
		"force-prefer-derp",
		strings.NewReader(strconv.Itoa(preferredRegion)),
	)
	restunErr := client.DebugAction(actionCtx, "restun")
	return errors.Join(forceErr, restunErr)
}

func maintainAdaptiveDERPRouting(
	ctx context.Context,
	client derpRoutingClient,
	proxy *adaptiveDERPProxy,
	onChange func(derpRoutingResult),
) {
	ticker := time.NewTicker(derpRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			result, err := optimizeDERPRouting(ctx, client, proxy, probeDERPHTTPS)
			if err != nil || !result.changed {
				continue
			}
			if err := refreshTailnetRoutes(ctx, client, result.preferredRegion); err != nil {
				log.Printf("adaptive DERP refresh kept native selection: %v", err)
			}
			onChange(result)
		}
	}
}
