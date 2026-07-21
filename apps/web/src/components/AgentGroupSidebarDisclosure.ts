// FILE: AgentGroupSidebarDisclosure.ts
// Purpose: Persist Agent Group Session tree disclosure state on this device.
// Layer: Web sidebar UI state

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

const STORAGE_KEY = "agent-group:sidebar-session-disclosure:v1";
const MAX_REMEMBERED_SESSION_IDS = 5_000;

function sanitizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ].slice(-MAX_REMEMBERED_SESSION_IDS);
}

export function readAgentGroupCollapsedSessionIds(): ReadonlySet<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(sanitizeSessionIds(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")));
  } catch {
    return new Set();
  }
}

export function persistAgentGroupCollapsedSessionIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSessionIds([...ids])));
  } catch {
    // Disclosure is a convenience; storage failures must not block the sidebar.
  }
}

export function useAgentGroupSidebarDisclosure(): {
  collapsedSessionIds: ReadonlySet<string>;
  setCollapsedSessionIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  forgetCollapsedSession: (sessionId: string) => void;
} {
  const [collapsedSessionIds, setState] = useState<ReadonlySet<string>>(
    readAgentGroupCollapsedSessionIds,
  );

  const setCollapsedSessionIds = useCallback<Dispatch<SetStateAction<ReadonlySet<string>>>>(
    (action) => {
      setState((current) => {
        const next = typeof action === "function" ? action(current) : action;
        if (next === current) return current;
        persistAgentGroupCollapsedSessionIds(next);
        return next;
      });
    },
    [],
  );

  const forgetCollapsedSession = useCallback(
    (sessionId: string) => {
      setCollapsedSessionIds((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    },
    [setCollapsedSessionIds],
  );

  return { collapsedSessionIds, setCollapsedSessionIds, forgetCollapsedSession };
}
