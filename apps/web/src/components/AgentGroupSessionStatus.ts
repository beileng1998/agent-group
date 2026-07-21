import type { SidebarThreadSummary } from "~/types";

import { resolveThreadStatusPill } from "./Sidebar.logic";

export type AgentGroupSessionStatusKind =
  | "error"
  | "pending-approval"
  | "awaiting-input"
  | "working"
  | "connecting"
  | "plan-ready"
  | "completed";

export interface AgentGroupSessionStatus {
  readonly kind: AgentGroupSessionStatusKind;
  readonly label: string;
  readonly colorClass: string;
  readonly dotClass: string;
  readonly pulse: boolean;
}

export interface AgentGroupSessionStatusTarget {
  readonly status: AgentGroupSessionStatus;
  readonly threadId: SidebarThreadSummary["id"];
  readonly title: string;
}

const KIND_BY_LABEL = {
  "Pending Approval": "pending-approval",
  "Awaiting Input": "awaiting-input",
  Working: "working",
  Connecting: "connecting",
  "Plan Ready": "plan-ready",
  Completed: "completed",
} as const satisfies Record<string, AgentGroupSessionStatusKind>;

export function resolveAgentGroupSessionStatus(
  thread: SidebarThreadSummary,
): AgentGroupSessionStatus | null {
  if (thread.latestTurn?.state === "error" || thread.session?.status === "error") {
    return {
      kind: "error",
      label: "Error",
      colorClass: "text-destructive",
      dotClass: "bg-destructive",
      pulse: false,
    };
  }

  const status = resolveThreadStatusPill({
    thread,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
  });
  if (!status) return null;

  return {
    kind: KIND_BY_LABEL[status.label],
    label: status.label,
    colorClass: status.colorClass,
    dotClass: status.dotClass,
    pulse: status.pulse,
  };
}

export function agentGroupSessionNeedsAttention(status: AgentGroupSessionStatus | null): boolean {
  return (
    status?.kind === "error" ||
    status?.kind === "pending-approval" ||
    status?.kind === "awaiting-input" ||
    status?.kind === "plan-ready"
  );
}

export function agentGroupSessionIsRunning(status: AgentGroupSessionStatus | null): boolean {
  return status?.kind === "working" || status?.kind === "connecting";
}

export function agentGroupSessionStatusPriority(status: AgentGroupSessionStatus | null): number {
  switch (status?.kind) {
    case "error":
      return 7;
    case "pending-approval":
      return 6;
    case "awaiting-input":
      return 5;
    case "plan-ready":
      return 4;
    case "working":
      return 3;
    case "connecting":
      return 2;
    case "completed":
      return 1;
    default:
      return 0;
  }
}

export function agentGroupSessionStatusShortLabel(status: AgentGroupSessionStatus): string {
  switch (status.kind) {
    case "pending-approval":
      return "Approve";
    case "awaiting-input":
      return "Input";
    case "plan-ready":
      return "Plan";
    case "error":
      return "Error";
    case "working":
      return "Working";
    case "connecting":
      return "Connecting";
    case "completed":
      return "Done";
  }
}

export function resolveAgentGroupSessionStatusTarget(input: {
  readonly childrenByParent: ReadonlyMap<string, readonly SidebarThreadSummary[]>;
  readonly includeDescendants: boolean;
  readonly thread: SidebarThreadSummary;
}): AgentGroupSessionStatusTarget | null {
  let best: AgentGroupSessionStatusTarget | null = null;
  const visited = new Set<string>();

  const visit = (thread: SidebarThreadSummary) => {
    if (visited.has(thread.id)) return;
    visited.add(thread.id);
    const status = resolveAgentGroupSessionStatus(thread);
    if (
      status &&
      (!best ||
        agentGroupSessionStatusPriority(status) > agentGroupSessionStatusPriority(best.status))
    ) {
      best = { status, threadId: thread.id, title: thread.title || "New session" };
    }
    if (!input.includeDescendants) return;
    for (const child of input.childrenByParent.get(thread.id) ?? []) visit(child);
  };

  visit(input.thread);
  return best;
}
