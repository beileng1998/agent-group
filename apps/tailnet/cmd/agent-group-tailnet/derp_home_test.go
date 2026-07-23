package main

import (
	"reflect"
	"testing"
	"time"
)

type fakeDERPHomeController struct {
	selected int
	actions  []string
}

func (f *fakeDERPHomeController) DebugForcePreferDERP(region int) {
	f.actions = append(f.actions, "prefer")
}

func (f *fakeDERPHomeController) ForceSetNearestDERP(region int) int {
	f.actions = append(f.actions, "switch")
	return f.selected
}

func (f *fakeDERPHomeController) ReSTUN(reason string) {
	f.actions = append(f.actions, reason)
}

func TestApplyDERPHomeSwitchesImmediately(t *testing.T) {
	home := &fakeDERPHomeController{selected: 20}
	if err := applyDERPHome(home, 20); err != nil {
		t.Fatal(err)
	}
	want := []string{"prefer", "switch", adaptiveDERPReason}
	if !reflect.DeepEqual(home.actions, want) {
		t.Fatalf("unexpected DERP home actions %v", home.actions)
	}
}

func TestApplyDERPHomeRejectsFailedSwitch(t *testing.T) {
	home := &fakeDERPHomeController{selected: 17}
	if err := applyDERPHome(home, 20); err == nil {
		t.Fatal("expected mismatched DERP home to fail")
	}
	if !reflect.DeepEqual(home.actions, []string{"prefer", "switch"}) {
		t.Fatalf("restun must not hide a failed switch: %v", home.actions)
	}
}

func TestDERPHomeReappliesAfterNativeRouteDrift(t *testing.T) {
	result := derpRoutingResult{
		best:              derpRoute{regionID: 20, regionCode: "hkg", proxyLatency: 141 * time.Millisecond},
		hasBest:           true,
		currentRegionCode: "lax",
		preferredRegion:   20,
	}
	if !result.shouldApplyHome() {
		t.Fatal("expected a stale native route to be corrected even without probe changes")
	}
	result.markHomeApplied()
	if result.currentRegionCode != "hkg" {
		t.Fatalf("expected applied route in diagnostics, got %q", result.currentRegionCode)
	}
	if got := result.message(); got != "Active relay: hkg (141 ms through the system proxy)." {
		t.Fatalf("unexpected applied route message %q", got)
	}
}
