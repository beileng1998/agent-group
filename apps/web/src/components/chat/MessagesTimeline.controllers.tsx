// FILE: MessagesTimeline.controllers.tsx
// Purpose: Own stable rows and transient transcript presentation lifecycles.
// Layer: Web chat timeline controllers

import type { MessageId } from "@agent-group/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatClockElapsed } from "../../session-logic";
import type { WorktreeSetupSnapshot } from "../../types";
import { DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import {
  computeStableMessagesTimelineRows,
  type CollapsedTurnItem,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic";
import {
  MESSAGE_SEND_ENTER_ANIMATION_MS,
  MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS,
  TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS,
} from "./MessagesTimeline.motion";

type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];

export type SettledTurnCollapseTransition = {
  open: boolean;
  items: readonly CollapsedTurnItem[];
};

type SettledTurnCollapseTimer = {
  closeFrame: number | null;
  cleanupTimeout: number | null;
};

export function findToolDetailsEntryById(
  rows: ReadonlyArray<MessagesTimelineRow>,
  entryId: string | null,
): TimelineWorkEntry | null {
  if (!entryId) return null;
  for (const row of rows) {
    if (row.kind === "work") {
      const matchingEntry = row.groupedEntries.find((entry) => entry.id === entryId);
      if (matchingEntry) return matchingEntry;
      continue;
    }
    if (row.kind !== "message") continue;
    const matchingLeadingEntry = row.leadingWorkEntries?.find((entry) => entry.id === entryId);
    if (matchingLeadingEntry) return matchingLeadingEntry;
    const matchingInlineEntry = row.inlineWorkEntries?.find((entry) => entry.id === entryId);
    if (matchingInlineEntry) return matchingInlineEntry;
    const matchingCollapsedEntry = row.collapsedTurnItems?.find(
      (item) => item.entry.id === entryId,
    );
    if (matchingCollapsedEntry) return matchingCollapsedEntry.entry;
  }
  return null;
}

export function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const previousStateRef = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });
  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, previousStateRef.current);
    previousStateRef.current = nextState;
    return nextState.result;
  }, [rows]);
}

export function useMessageSendEnterAnimations(
  rows: readonly MessagesTimelineRow[],
  enteringUserMessageIds: ReadonlySet<MessageId>,
): ReadonlySet<string> {
  const [enteringRowIds, setEnteringRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const previousRowIdsRef = useRef<ReadonlySet<string> | null>(null);
  const cleanupTimeoutsRef = useRef<number[]>([]);

  useLayoutEffect(() => {
    const currentRowIds = new Set(rows.map((row) => row.id));
    const previousRowIds = previousRowIdsRef.current;
    previousRowIdsRef.current = currentRowIds;
    const freshUserRowIds = rows
      .filter(
        (row) =>
          row.kind === "message" &&
          row.message.role === "user" &&
          enteringUserMessageIds.has(row.message.id) &&
          (previousRowIds === null || !previousRowIds.has(row.id)),
      )
      .map((row) => row.id);
    if (freshUserRowIds.length === 0) return;

    setEnteringRowIds((current) => {
      const next = new Set(current);
      for (const rowId of freshUserRowIds) next.add(rowId);
      return next;
    });
    const cleanupTimeout = window.setTimeout(() => {
      cleanupTimeoutsRef.current = cleanupTimeoutsRef.current.filter((id) => id !== cleanupTimeout);
      setEnteringRowIds((current) => {
        const next = new Set(current);
        for (const rowId of freshUserRowIds) next.delete(rowId);
        return next.size === current.size ? current : next;
      });
    }, MESSAGE_SEND_ENTER_ANIMATION_MS + MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS);
    cleanupTimeoutsRef.current.push(cleanupTimeout);
  }, [enteringUserMessageIds, rows]);

  useEffect(
    () => () => {
      for (const timeoutId of cleanupTimeoutsRef.current) window.clearTimeout(timeoutId);
      cleanupTimeoutsRef.current = [];
    },
    [],
  );
  return enteringRowIds;
}

export interface WorktreeSetupPresentation {
  snapshot: WorktreeSetupSnapshot;
  open: boolean;
}

export function useWorktreeSetupPresentation(
  worktreeSetup: WorktreeSetupSnapshot | null,
): WorktreeSetupPresentation | null {
  const [presented, setPresented] = useState<WorktreeSetupPresentation | null>(null);
  const closeFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);
  const clearCloseTimers = useCallback(() => {
    if (closeFrameRef.current !== null) {
      window.cancelAnimationFrame(closeFrameRef.current);
      closeFrameRef.current = null;
    }
    if (cleanupTimeoutRef.current !== null) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (worktreeSetup) {
      clearCloseTimers();
      setPresented((current) =>
        current?.open && current.snapshot === worktreeSetup
          ? current
          : { snapshot: worktreeSetup, open: true },
      );
      return;
    }
    if (!presented?.open || closeFrameRef.current !== null) return;
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = null;
      setPresented((current) => (current?.open ? { ...current, open: false } : current));
      cleanupTimeoutRef.current = window.setTimeout(() => {
        cleanupTimeoutRef.current = null;
        setPresented(null);
      }, DISCLOSURE_TRANSITION_MS + TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS);
    });
  }, [worktreeSetup, presented, clearCloseTimers]);

  useLayoutEffect(() => clearCloseTimers, [clearCloseTimers]);
  return presented;
}

export function useSettledTurnCollapseTransitions(
  rows: readonly MessagesTimelineRow[],
): Readonly<Record<string, SettledTurnCollapseTransition>> {
  const [transitions, setTransitions] = useState<Record<string, SettledTurnCollapseTransition>>({});
  const previousAssistantMessageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousCollapsedSignaturesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const timersRef = useRef(new Map<string, SettledTurnCollapseTimer>());

  const clearTransitionTimer = useCallback((messageId: string) => {
    const timer = timersRef.current.get(messageId);
    if (!timer) return;
    if (timer.closeFrame !== null) window.cancelAnimationFrame(timer.closeFrame);
    if (timer.cleanupTimeout !== null) window.clearTimeout(timer.cleanupTimeout);
    timersRef.current.delete(messageId);
  }, []);

  const scheduleTransitionClose = useCallback(
    (messageId: string) => {
      clearTransitionTimer(messageId);
      const closeFrame = window.requestAnimationFrame(() => {
        const timer = timersRef.current.get(messageId);
        if (!timer) return;
        timersRef.current.set(messageId, { ...timer, closeFrame: null });
        setTransitions((current) => {
          const transition = current[messageId];
          if (!transition || !transition.open) return current;
          return { ...current, [messageId]: { ...transition, open: false } };
        });
        const cleanupTimeout = window.setTimeout(() => {
          timersRef.current.delete(messageId);
          setTransitions((current) => {
            if (!current[messageId]) return current;
            const next = { ...current };
            delete next[messageId];
            return next;
          });
        }, DISCLOSURE_TRANSITION_MS + TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS);
        timersRef.current.set(messageId, { closeFrame: null, cleanupTimeout });
      });
      timersRef.current.set(messageId, { closeFrame, cleanupTimeout: null });
    },
    [clearTransitionTimer],
  );

  useLayoutEffect(() => {
    const currentAssistantMessageIds = new Set<string>();
    const currentCollapsed = new Map<
      string,
      { signature: string; items: readonly CollapsedTurnItem[] }
    >();
    for (const row of rows) {
      if (row.kind !== "message" || row.message.role !== "assistant") continue;
      const messageId = row.message.id;
      currentAssistantMessageIds.add(messageId);
      if (row.collapsedTurnItems && row.collapsedTurnItems.length > 0) {
        currentCollapsed.set(messageId, {
          signature: collapsedTurnItemsSignature(row.collapsedTurnItems),
          items: row.collapsedTurnItems,
        });
      }
    }

    const previousAssistantMessageIds = previousAssistantMessageIdsRef.current;
    const previousCollapsedSignatures = previousCollapsedSignaturesRef.current;
    const startedTransitions: Array<{
      messageId: string;
      items: readonly CollapsedTurnItem[];
    }> = [];
    for (const [messageId, collapsed] of currentCollapsed) {
      if (
        previousAssistantMessageIds.has(messageId) &&
        !previousCollapsedSignatures.has(messageId)
      ) {
        startedTransitions.push({ messageId, items: collapsed.items });
      }
    }
    previousAssistantMessageIdsRef.current = currentAssistantMessageIds;
    previousCollapsedSignaturesRef.current = new Map(
      Array.from(currentCollapsed, ([messageId, collapsed]) => [messageId, collapsed.signature]),
    );

    setTransitions((current) => {
      let next: Record<string, SettledTurnCollapseTransition> | null = null;
      const ensureNext = () => (next ??= { ...current });
      for (const messageId of Object.keys(current)) {
        if (!currentCollapsed.has(messageId)) {
          clearTransitionTimer(messageId);
          delete ensureNext()[messageId];
        }
      }
      for (const transition of startedTransitions) {
        ensureNext()[transition.messageId] = { open: true, items: transition.items };
      }
      return next ?? current;
    });
    for (const transition of startedTransitions) scheduleTransitionClose(transition.messageId);
  }, [clearTransitionTimer, rows, scheduleTransitionClose]);

  useEffect(
    () => () => {
      for (const messageId of Array.from(timersRef.current.keys())) {
        clearTransitionTimer(messageId);
      }
    },
    [clearTransitionTimer],
  );
  return transitions;
}

function collapsedTurnItemsSignature(items: readonly CollapsedTurnItem[]): string {
  return items.map((item) => `${item.kind}:${item.id}`).join("|");
}

export function WorkingTimer({ createdAt }: { createdAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatWorkingTimerNow(createdAt);
  useEffect(() => {
    const updateText = () => {
      if (textRef.current) textRef.current.textContent = formatWorkingTimerNow(createdAt);
    };
    updateText();
    const id = window.setInterval(updateText, 1000);
    return () => window.clearInterval(id);
  }, [createdAt]);
  return <span ref={textRef}>{initialText}</span>;
}

export function formatWorkingTimer(startIso: string, endIso: string): string | null {
  return formatClockElapsed(startIso, endIso);
}

function formatWorkingTimerNow(startIso: string): string {
  return formatWorkingTimer(startIso, new Date().toISOString()) ?? "0s";
}

export function formatInlineWorkSummary(_groupedEntries: TimelineWorkEntry[]): string | null {
  return null;
}
