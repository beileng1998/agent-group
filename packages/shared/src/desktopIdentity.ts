// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

export const AGENT_GROUP_DESKTOP_SCHEME = "agent-group";
export const AGENT_GROUP_DESKTOP_ORIGIN = `${AGENT_GROUP_DESKTOP_SCHEME}://app`;
export const AGENT_GROUP_DESKTOP_ENTRY_URL = `${AGENT_GROUP_DESKTOP_ORIGIN}/index.html`;
export const AGENT_GROUP_DESKTOP_UPDATE_CHANNEL = "agent-group";
export const AGENT_GROUP_PRODUCTION_BUNDLE_ID = "app.agentgroup.desktop";
export const AGENT_GROUP_DEVELOPMENT_BUNDLE_ID = `${AGENT_GROUP_PRODUCTION_BUNDLE_ID}.dev`;

export function agentGroupBundleId(isDevelopment: boolean): string {
  return isDevelopment ? AGENT_GROUP_DEVELOPMENT_BUNDLE_ID : AGENT_GROUP_PRODUCTION_BUNDLE_ID;
}
