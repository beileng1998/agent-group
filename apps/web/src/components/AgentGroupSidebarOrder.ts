import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useCallback, useState } from "react";

import type { SidebarThreadSummary } from "~/types";

const STORAGE_KEY = "agent-group:sidebar-session-order:v1";

type SessionOrderByGroup = Record<string, string[]>;

function compareCreatedAt(
  left: { id: string; createdAt: string },
  right: { id: string; createdAt: string },
): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

export function orderAgentGroupSessions<
  T extends { id: string; createdAt: string; isPinned?: boolean },
>(sessions: readonly T[], rememberedIds: readonly string[] = []): T[] {
  const rankById = new Map(rememberedIds.map((id, index) => [id, index] as const));

  return sessions.toSorted((left, right) => {
    const byPin = Number(right.isPinned === true) - Number(left.isPinned === true);
    if (byPin !== 0) return byPin;

    const leftRank = rankById.get(left.id);
    const rightRank = rankById.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank === undefined && rightRank !== undefined) return -1;
    if (leftRank !== undefined && rightRank === undefined) return 1;
    return compareCreatedAt(left, right);
  });
}

export function reorderAgentGroupSessionIds(
  orderedIds: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId) return [...orderedIds];
  const draggedIndex = orderedIds.indexOf(draggedId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0) return [...orderedIds];

  const next = [...orderedIds];
  const [dragged] = next.splice(draggedIndex, 1);
  if (!dragged) return [...orderedIds];
  next.splice(targetIndex, 0, dragged);
  return next;
}

function readStoredOrder(): SessionOrderByGroup {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([groupId, value]) => {
        if (!Array.isArray(value)) return [];
        const ids = [...new Set(value.filter((id): id is string => typeof id === "string"))];
        return [[groupId, ids]];
      }),
    );
  } catch {
    return {};
  }
}

function persistStoredOrder(value: SessionOrderByGroup): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ordering is a convenience; storage failures must not block the sidebar.
  }
}

export function useAgentGroupSidebarOrder() {
  const [orderByGroup, setOrderByGroup] = useState<SessionOrderByGroup>(readStoredOrder);

  const orderSessions = useCallback(
    (groupId: ProjectId, sessions: readonly SidebarThreadSummary[]) =>
      orderAgentGroupSessions(sessions, orderByGroup[groupId]),
    [orderByGroup],
  );

  const reorderSessions = useCallback(
    (
      groupId: ProjectId,
      sessions: readonly SidebarThreadSummary[],
      draggedId: ThreadId,
      targetId: ThreadId,
    ) => {
      setOrderByGroup((current) => {
        const orderedIds = orderAgentGroupSessions(sessions, current[groupId]).map(
          (session) => session.id,
        );
        const next = {
          ...current,
          [groupId]: reorderAgentGroupSessionIds(orderedIds, draggedId, targetId),
        };
        persistStoredOrder(next);
        return next;
      });
    },
    [],
  );

  const forgetSession = useCallback((groupId: ProjectId, sessionId: ThreadId) => {
    setOrderByGroup((current) => {
      const remembered = current[groupId];
      if (!remembered?.includes(sessionId)) return current;
      const next = { ...current, [groupId]: remembered.filter((id) => id !== sessionId) };
      persistStoredOrder(next);
      return next;
    });
  }, []);

  const forgetGroup = useCallback((groupId: ProjectId) => {
    setOrderByGroup((current) => {
      if (!(groupId in current)) return current;
      const { [groupId]: _removed, ...next } = current;
      persistStoredOrder(next);
      return next;
    });
  }, []);

  return { forgetGroup, forgetSession, orderSessions, reorderSessions };
}
