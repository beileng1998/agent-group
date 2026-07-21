import { describe, expect, it } from "vitest";

import {
  AGENT_GROUP_DESKTOP_ENTRY_URL,
  AGENT_GROUP_DESKTOP_ORIGIN,
  AGENT_GROUP_DESKTOP_UPDATE_CHANNEL,
  AGENT_GROUP_DEVELOPMENT_BUNDLE_ID,
  AGENT_GROUP_PRODUCTION_BUNDLE_ID,
  agentGroupBundleId,
} from "./desktopIdentity";

describe("desktopIdentity", () => {
  it("uses the exact canonical production and development bundle IDs", () => {
    expect(AGENT_GROUP_PRODUCTION_BUNDLE_ID).toBe("app.agentgroup.desktop");
    expect(AGENT_GROUP_DEVELOPMENT_BUNDLE_ID).toBe("app.agentgroup.desktop.dev");
    expect(agentGroupBundleId(false)).toBe(AGENT_GROUP_PRODUCTION_BUNDLE_ID);
    expect(agentGroupBundleId(true)).toBe(AGENT_GROUP_DEVELOPMENT_BUNDLE_ID);
  });

  it("uses the exact packaged renderer origin and entry URL", () => {
    expect(AGENT_GROUP_DESKTOP_ORIGIN).toBe("agent-group://app");
    expect(AGENT_GROUP_DESKTOP_ENTRY_URL).toBe("agent-group://app/index.html");
  });

  it("uses the Agent Group desktop update channel", () => {
    expect(AGENT_GROUP_DESKTOP_UPDATE_CHANNEL).toBe("agent-group");
  });
});
