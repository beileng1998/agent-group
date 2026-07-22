package main

import (
	"context"
	"log"
	"time"

	"tailscale.com/ipn/ipnstate"
)

const (
	peerMonitorInterval = 5 * time.Second
	peerStallWindow     = 20 * time.Second
	staleHandshakeAge   = 3 * time.Minute
	recoveryCooldown    = 90 * time.Second
)

type tailnetRecoveryClient interface {
	Status(context.Context) (*ipnstate.Status, error)
	DebugAction(context.Context, string) error
}

type peerProgress struct {
	rxBytes       int64
	lastHandshake time.Time
	stalledSince  time.Time
}

type peerLivenessTracker struct {
	peers        map[string]peerProgress
	lastRecovery time.Time
}

func newPeerLivenessTracker() *peerLivenessTracker {
	return &peerLivenessTracker{peers: make(map[string]peerProgress)}
}

func (t *peerLivenessTracker) observe(now time.Time, status *ipnstate.Status) bool {
	seen := make(map[string]struct{}, len(status.Peer))
	recover := false
	for _, peer := range status.Peer {
		id := string(peer.ID)
		if id == "" {
			id = peer.PublicKey.String()
		}
		seen[id] = struct{}{}
		previous := t.peers[id]
		progressed := peer.RxBytes > previous.rxBytes || peer.LastHandshake.After(previous.lastHandshake)
		stalled := peer.Online && peer.Active && !peer.LastWrite.IsZero() &&
			now.Sub(peer.LastWrite) <= peerStallWindow &&
			(peer.LastHandshake.IsZero() || now.Sub(peer.LastHandshake) >= staleHandshakeAge)

		next := peerProgress{rxBytes: peer.RxBytes, lastHandshake: peer.LastHandshake}
		if stalled && !progressed {
			next.stalledSince = previous.stalledSince
			if next.stalledSince.IsZero() {
				next.stalledSince = now
			}
			if now.Sub(next.stalledSince) >= peerStallWindow {
				recover = true
			}
		}
		t.peers[id] = next
	}
	for id := range t.peers {
		if _, ok := seen[id]; !ok {
			delete(t.peers, id)
		}
	}
	if !recover || (!t.lastRecovery.IsZero() && now.Sub(t.lastRecovery) < recoveryCooldown) {
		return false
	}
	t.lastRecovery = now
	for id, progress := range t.peers {
		progress.stalledSince = time.Time{}
		t.peers[id] = progress
	}
	return true
}

func monitorTailnetLiveness(ctx context.Context, client tailnetRecoveryClient) {
	tracker := newPeerLivenessTracker()
	ticker := time.NewTicker(peerMonitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			statusCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			status, err := client.Status(statusCtx)
			cancel()
			if err != nil || status == nil || !tracker.observe(now, status) {
				continue
			}
			actionCtx, actionCancel := context.WithTimeout(ctx, 5*time.Second)
			if err := client.DebugAction(actionCtx, "rebind"); err != nil {
				log.Printf("stalled Tailnet peer recovery failed: %v", err)
			} else if err := client.DebugAction(actionCtx, "restun"); err != nil {
				log.Printf("Tailnet peer rebound but re-STUN failed: %v", err)
			} else {
				log.Printf("recovered stalled Tailnet peer path")
			}
			actionCancel()
		}
	}
}
