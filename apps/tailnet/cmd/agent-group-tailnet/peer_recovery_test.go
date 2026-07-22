package main

import (
	"testing"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

func TestPeerLivenessTrackerRecoversOnlyAfterSustainedStall(t *testing.T) {
	tracker := newPeerLivenessTracker()
	started := time.Unix(10_000, 0)
	peer := &ipnstate.PeerStatus{
		ID:            tailcfg.StableNodeID("phone"),
		Online:        true,
		Active:        true,
		RxBytes:       100,
		LastHandshake: started.Add(-staleHandshakeAge),
		LastWrite:     started,
	}
	status := statusWithPeer(peer)
	if tracker.observe(started, status) {
		t.Fatal("must not recover on the first stale observation")
	}
	for elapsed := 5 * time.Second; elapsed < 25*time.Second; elapsed += 5 * time.Second {
		now := started.Add(elapsed)
		peer.LastWrite = now
		if tracker.observe(now, status) {
			t.Fatalf("must not recover before the stall window at %v", elapsed)
		}
	}
	now := started.Add(25 * time.Second)
	peer.LastWrite = now
	if !tracker.observe(now, status) {
		t.Fatal("expected recovery after sustained outbound activity without inbound progress")
	}
	peer.LastWrite = now.Add(5 * time.Second)
	if tracker.observe(now.Add(5*time.Second), status) {
		t.Fatal("recovery cooldown must prevent a rebind loop")
	}
}

func TestPeerLivenessTrackerResetsOnInboundProgress(t *testing.T) {
	tracker := newPeerLivenessTracker()
	started := time.Unix(20_000, 0)
	peer := &ipnstate.PeerStatus{
		ID:            tailcfg.StableNodeID("phone"),
		Online:        true,
		Active:        true,
		RxBytes:       100,
		LastHandshake: started.Add(-staleHandshakeAge),
		LastWrite:     started,
	}
	status := statusWithPeer(peer)
	tracker.observe(started, status)
	peer.LastWrite = started.Add(10 * time.Second)
	tracker.observe(started.Add(10*time.Second), status)
	peer.RxBytes++
	peer.LastWrite = started.Add(20 * time.Second)
	if tracker.observe(started.Add(20*time.Second), status) {
		t.Fatal("inbound progress must clear a pending stall")
	}
	peer.LastWrite = started.Add(35 * time.Second)
	if tracker.observe(started.Add(35*time.Second), status) {
		t.Fatal("a fresh stall must receive a full recovery window")
	}
}

func TestPeerLivenessTrackerIgnoresFreshHandshakes(t *testing.T) {
	tracker := newPeerLivenessTracker()
	started := time.Unix(30_000, 0)
	peer := &ipnstate.PeerStatus{
		ID:            tailcfg.StableNodeID("phone"),
		Online:        true,
		Active:        true,
		LastHandshake: started,
		LastWrite:     started,
	}
	status := statusWithPeer(peer)
	for elapsed := time.Duration(0); elapsed <= peerStallWindow*2; elapsed += 5 * time.Second {
		now := started.Add(elapsed)
		peer.LastWrite = now
		if tracker.observe(now, status) {
			t.Fatal("fresh WireGuard handshakes must not trigger recovery")
		}
	}
}

func statusWithPeer(peer *ipnstate.PeerStatus) *ipnstate.Status {
	return &ipnstate.Status{Peer: map[key.NodePublic]*ipnstate.PeerStatus{{}: peer}}
}
