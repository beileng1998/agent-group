import { describe, expect, it } from "vitest";

import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";

import { agentGroupSidebarHeaderClassName } from "./AgentGroupSidebarHeader.logic";

describe("agentGroupSidebarHeaderClassName", () => {
  it("reserves native traffic-light space only on macOS Electron", () => {
    expect(agentGroupSidebarHeaderClassName({ isElectron: true, isMacDesktop: true })).toContain(
      DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
    );
    expect(
      agentGroupSidebarHeaderClassName({ isElectron: false, isMacDesktop: true }),
    ).not.toContain(DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS);
    expect(
      agentGroupSidebarHeaderClassName({ isElectron: true, isMacDesktop: false }),
    ).not.toContain(DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS);
  });
});
