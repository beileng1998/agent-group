// FILE: usePlanSidebarController.ts
// Purpose: Own plan/task sidebar selection and open/dismiss state.
// Layer: Web plan presentation controller

import { type OrchestrationLatestTurn } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findLatestProposedPlan, findSidebarProposedPlan } from "../session-logic";
import { useStore } from "../store";
import { createThreadSelector } from "../storeSelectors";
import type { Thread } from "../types";

export function usePlanSidebarController(input: {
  activeThread: Thread | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  latestTurnSettled: boolean;
  activeTaskListTurnId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const dismissedForTurnRef = useRef<string | null>(null);
  const openOnNextThreadRef = useRef(false);

  const activeProposedPlan = useMemo(() => {
    if (!input.latestTurnSettled) return null;
    return findLatestProposedPlan(
      input.activeThread?.proposedPlans ?? [],
      input.latestTurn?.turnId ?? null,
    );
  }, [input.activeThread?.proposedPlans, input.latestTurn?.turnId, input.latestTurnSettled]);

  const sourceThreadId = !input.latestTurnSettled
    ? (input.latestTurn?.sourceProposedPlan?.threadId ?? null)
    : null;
  const sourceThread = useStore(
    useMemo(() => createThreadSelector(sourceThreadId), [sourceThreadId]),
  );
  const activeThreadId = input.activeThread?.id ?? null;
  const activeThreadPlans = input.activeThread?.proposedPlans;
  const sourceThreadIdForPlan = sourceThread?.id ?? null;
  const sourceThreadPlans = sourceThread?.proposedPlans;
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: [
          ...(activeThreadId
            ? [{ id: activeThreadId, proposedPlans: activeThreadPlans ?? [] }]
            : []),
          ...(sourceThreadIdForPlan && sourceThreadIdForPlan !== activeThreadId
            ? [{ id: sourceThreadIdForPlan, proposedPlans: sourceThreadPlans ?? [] }]
            : []),
        ],
        latestTurn: input.latestTurn,
        latestTurnSettled: input.latestTurnSettled,
        threadId: activeThreadId,
      }),
    [
      activeThreadId,
      activeThreadPlans,
      input.latestTurn,
      input.latestTurnSettled,
      sourceThreadIdForPlan,
      sourceThreadPlans,
    ],
  );

  const currentTurnKey = input.activeTaskListTurnId ?? sidebarProposedPlan?.turnId ?? null;
  const toggle = useCallback(() => {
    setOpen((currentlyOpen) => {
      dismissedForTurnRef.current = currentlyOpen ? (currentTurnKey ?? "__dismissed__") : null;
      return !currentlyOpen;
    });
  }, [currentTurnKey]);
  const show = useCallback(() => setOpen(true), []);
  const showForCurrentTurn = useCallback(() => {
    dismissedForTurnRef.current = null;
    setOpen(true);
  }, []);
  const closeAndDismiss = useCallback(() => {
    setOpen(false);
    if (currentTurnKey) {
      dismissedForTurnRef.current = currentTurnKey;
    }
  }, [currentTurnKey]);
  const showOnNextThread = useCallback(() => {
    openOnNextThreadRef.current = true;
  }, []);

  useEffect(() => {
    if (openOnNextThreadRef.current) {
      openOnNextThreadRef.current = false;
      setOpen(true);
    } else {
      setOpen(false);
    }
    dismissedForTurnRef.current = null;
  }, [activeThreadId]);

  const label = sidebarProposedPlan ? "Plan details" : "Tasks";
  return {
    activeProposedPlan,
    closeAndDismiss,
    label,
    open,
    show,
    showForCurrentTurn,
    showOnNextThread,
    sidebarProposedPlan,
    toggle,
    toggleLabel: open ? `Hide ${label}` : label,
    toggleTitle: `${open ? "Hide" : "Show"} ${label.toLowerCase()} sidebar`,
  };
}
