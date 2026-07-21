import type { ProjectId, ThreadId } from "@agent-group/contracts";

export type HighlightScopeLevel = "session" | "subtree" | "group" | "global";

export interface HighlightScopeState {
  readonly level: HighlightScopeLevel;
  readonly sessionId: ThreadId;
  readonly projectId: ProjectId;
  readonly query?: string;
}
