package main

import "fmt"

const adaptiveDERPReason = "agent-group-adaptive-route"

// derpHomeController is the only compatibility boundary around tsnet's
// unstable subsystem API. The sidecar pins the Tailscale version, while the
// host application remains unaware of DERP routing.
type derpHomeController interface {
	DebugForcePreferDERP(int)
	ForceSetNearestDERP(int) int
	ReSTUN(string)
}

func applyDERPHome(home derpHomeController, preferredRegion int) error {
	home.DebugForcePreferDERP(preferredRegion)
	if preferredRegion != 0 {
		if selected := home.ForceSetNearestDERP(preferredRegion); selected != preferredRegion {
			return fmt.Errorf(
				"requested DERP region %d but Tailscale selected %d",
				preferredRegion,
				selected,
			)
		}
	}
	home.ReSTUN(adaptiveDERPReason)
	return nil
}

func (r derpRoutingResult) shouldApplyHome() bool {
	if r.changed {
		return true
	}
	return r.preferredRegion != 0 &&
		r.hasBest &&
		r.best.regionID == r.preferredRegion &&
		r.currentRegionCode != r.best.regionCode
}

func (r *derpRoutingResult) markHomeApplied() {
	if r.preferredRegion == 0 || !r.hasBest || r.best.regionID != r.preferredRegion {
		return
	}
	latency, reachable := r.best.plannedLatency()
	r.currentRegionCode = r.best.regionCode
	r.currentLatency = latency
	r.currentReachable = reachable
}
