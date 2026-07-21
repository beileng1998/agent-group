import {
  isAgentGroupSessionThread,
  isPromotedSidechatThread,
  isTemporarySidechatThread,
  type AgentGroupThreadCandidate,
} from "@agent-group/shared/agentGroupSessions";
import type { RightDockPaneKind } from "./rightDockStore.contracts";

interface AgentGroupSessionCandidate extends AgentGroupThreadCandidate {
  readonly archivedAt?: string | null | undefined;
}

export function isAgentGroupSession(candidate: AgentGroupSessionCandidate): boolean {
  return !candidate.archivedAt && isAgentGroupSessionThread(candidate);
}

export { isPromotedSidechatThread, isTemporarySidechatThread };

/**
 * Product-surface policy for Agent Group.
 *
 * Agent Group's implementation remains available underneath the shell, but only the
 * capabilities that support a shared-context agent group are exposed here.
 */
export const AGENT_GROUP_CAPABILITIES = {
  automations: false,
  checkpoints: false,
  handoff: false,
  pullRequests: false,
  sidechat: true,
  splitChat: false,
  temporaryThreads: false,
  upstreamWhatsNew: false,
  worktrees: false,
} as const;

export const AGENT_GROUP_APP_SLASH_COMMANDS: ReadonlySet<string> = new Set([
  "compact",
  "model",
  "fast",
  "plan",
  "default",
  "status",
  "subagents",
  "side",
]);

export const AGENT_GROUP_DOCK_KINDS = [
  "context",
  "highlights",
  "sidechat",
  "explorer",
  "terminal",
  "browser",
  "diff",
] as const satisfies readonly RightDockPaneKind[];

export const AGENT_GROUP_PERSISTED_DOCK_KINDS: ReadonlySet<RightDockPaneKind> = new Set([
  ...AGENT_GROUP_DOCK_KINDS,
  // Preserve old Group tabs long enough to redirect them to the independent settings sheet.
  "group",
  // File previews are opened from Explorer and transcript references, not the add menu.
  "file",
]);
