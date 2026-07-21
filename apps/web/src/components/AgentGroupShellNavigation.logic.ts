// FILE: AgentGroupShellNavigation.logic.ts
// Purpose: Resolves the durable "current session" target used by mobile shell navigation.
// Layer: Pure web shell logic

import type { SidebarThreadSummary } from "~/types";

function sessionActivityTime(session: SidebarThreadSummary): number {
  const value = session.lastVisitedAt ?? session.updatedAt ?? session.createdAt;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sessionIdFromPathname(pathname: string): string | null {
  return pathname.match(/^\/([^/]+)$/)?.[1] ?? null;
}

export function resolveCurrentAgentGroupSession(input: {
  readonly pathname: string;
  readonly rememberedSessionId: string | null;
  readonly sessions: readonly SidebarThreadSummary[];
}): SidebarThreadSummary | null {
  const routeSessionId = sessionIdFromPathname(input.pathname);
  const routeSession = input.sessions.find((session) => session.id === routeSessionId);
  if (routeSession) return routeSession;

  const rememberedSession = input.sessions.find(
    (session) => session.id === input.rememberedSessionId,
  );
  if (rememberedSession) return rememberedSession;

  return (
    input.sessions.toSorted(
      (left, right) => sessionActivityTime(right) - sessionActivityTime(left),
    )[0] ?? null
  );
}
