// FILE: useSidebarThreadInteractionOwner.ts
// Purpose: Own sidebar thread activation, selection, rename, and subagent expansion interactions.
// Layer: Web sidebar controller

import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { LastThreadRoute } from "../chatRouteRestore";
import { toastManager } from "../components/ui/toast";
import { dispatchThreadRename } from "../lib/threadRename";
import { isMacPlatform } from "../lib/utils";
import type { SplitView, SplitViewId, PaneId } from "../splitViewStore";
import type { selectThreadTerminalState } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import type { SidebarThreadSummary } from "../types";
import { useThreadActivationController } from "./useThreadActivationController";
import { useThreadDetailPrewarm } from "../threadDetailPrewarm";

type ThreadTerminalStateById = Parameters<typeof selectThreadTerminalState>[0];

interface UseSidebarThreadInteractionOwnerInput {
  readonly routeThreadId: ThreadId | null;
  readonly routeSplitViewId: string | null | undefined;
  readonly activeSplitView: SplitView | null;
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly splitViewsById: Record<SplitViewId, SplitView | undefined>;
  readonly terminalStateByThreadId: ThreadTerminalStateById;
  readonly openChatThreadPage: (threadId: ThreadId) => void;
  readonly openTerminalThreadPage: (threadId: ThreadId) => void;
  readonly openSidechatSplit: (input: {
    sidechatThreadId: ThreadId;
    sourceThreadId: ThreadId;
    ownerProjectId: ProjectId;
  }) => SplitViewId;
  readonly setSplitFocusedPane: (splitViewId: SplitViewId, paneId: PaneId) => void;
  readonly rememberLastThreadRouteNow: (route: LastThreadRoute) => void;
}

export function useSidebarThreadInteractionOwner({
  routeThreadId,
  routeSplitViewId,
  activeSplitView,
  sidebarThreadSummaryById,
  splitViewsById,
  terminalStateByThreadId,
  openChatThreadPage,
  openTerminalThreadPage,
  openSidechatSplit,
  setSplitFocusedPane,
  rememberLastThreadRouteNow,
}: UseSidebarThreadInteractionOwnerInput) {
  const navigate = useNavigate();
  const { prewarmThreadDetail } = useThreadDetailPrewarm();
  const selectedThreadIds = useThreadSelectionStore((state) => state.selectedThreadIds);
  const toggleSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const [optimisticActiveThreadId, setOptimisticActiveThreadId] = useState<ThreadId | null>(null);
  const [expandedSubagentParentIds, setExpandedSubagentParentIds] = useState<ReadonlySet<ThreadId>>(
    () => new Set(),
  );
  const [renameThreadId, setRenameThreadId] = useState<ThreadId | null>(null);
  const autoRevealedSubagentThreadIdRef = useRef<ThreadId | null>(null);
  const lastRenameTapRef = useRef<{ threadId: ThreadId; timestamp: number } | null>(null);
  const activeThreadId = optimisticActiveThreadId ?? routeThreadId;

  useEffect(() => {
    if (!optimisticActiveThreadId) return;
    if (routeThreadId === optimisticActiveThreadId) {
      setOptimisticActiveThreadId(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setOptimisticActiveThreadId((current) =>
        current === optimisticActiveThreadId ? null : current,
      );
    }, 1_500);
    return () => window.clearTimeout(timeout);
  }, [optimisticActiveThreadId, routeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      autoRevealedSubagentThreadIdRef.current = null;
      return;
    }
    if (autoRevealedSubagentThreadIdRef.current === activeThreadId) return;
    const forcedParentIds = new Set<ThreadId>();
    let currentId: ThreadId | null =
      sidebarThreadSummaryById[activeThreadId]?.parentThreadId ?? null;
    while (currentId) {
      forcedParentIds.add(currentId);
      currentId = sidebarThreadSummaryById[currentId]?.parentThreadId ?? null;
    }
    autoRevealedSubagentThreadIdRef.current = activeThreadId;
    if (forcedParentIds.size === 0) return;
    setExpandedSubagentParentIds((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const parentId of forcedParentIds) {
        if (next.has(parentId)) continue;
        next.add(parentId);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [activeThreadId, sidebarThreadSummaryById]);

  const toggleSubagents = useCallback((threadId: ThreadId) => {
    setExpandedSubagentParentIds((previous) => {
      const next = new Set(previous);
      next.has(threadId) ? next.delete(threadId) : next.add(threadId);
      return next;
    });
  }, []);
  const { activateThreadFromSidebarIntent } = useThreadActivationController({
    activeSplitView,
    clearSelection,
    navigate,
    openChatThreadPage,
    openSidechatSplit,
    openTerminalThreadPage,
    prewarmThreadDetailForIntent: prewarmThreadDetail,
    rememberLastThreadRouteNow,
    routeSplitViewId,
    routeThreadId,
    selectedThreadCount: selectedThreadIds.size,
    setOptimisticActiveThreadId,
    setSelectionAnchor,
    setSplitFocusedPane,
    sidebarThreadSummaryById,
    splitViewsById,
    terminalStateByThreadId,
  });
  const activateFromClick = useCallback(
    (
      event: MouseEvent,
      threadId: ThreadId,
      orderedThreadIds: readonly ThreadId[],
      options?: { isActive?: boolean; canToggleSubagents?: boolean },
    ) => {
      const modClick = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (modClick) {
        event.preventDefault();
        toggleSelection(threadId);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedThreadIds);
        return;
      }
      if (threadId === routeThreadId && options?.canToggleSubagents && !routeSplitViewId) {
        toggleSubagents(threadId);
        return;
      }
      activateThreadFromSidebarIntent(threadId);
    },
    [
      activateThreadFromSidebarIntent,
      rangeSelectTo,
      routeSplitViewId,
      routeThreadId,
      toggleSelection,
      toggleSubagents,
    ],
  );
  const primeActivation = useCallback(
    (event: PointerEvent<HTMLElement>, threadId: ThreadId) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      prewarmThreadDetail(threadId);
      setOptimisticActiveThreadId(threadId);
    },
    [prewarmThreadDetail],
  );
  const handleRenamePointerUp = useCallback(
    (event: PointerEvent<HTMLElement>, threadId: ThreadId) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const previous = lastRenameTapRef.current;
      if (previous?.threadId === threadId && event.timeStamp - previous.timestamp <= 320) {
        event.preventDefault();
        event.stopPropagation();
        lastRenameTapRef.current = null;
        setRenameThreadId(threadId);
        return;
      }
      lastRenameTapRef.current = { threadId, timestamp: event.timeStamp };
    },
    [],
  );
  const commitRename = useCallback(
    async (threadId: ThreadId, title: string, originalTitle: string) => {
      const outcome = await dispatchThreadRename({
        threadId,
        newTitle: title,
        unchangedTitles: [originalTitle],
      }).catch((cause) => {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: cause instanceof Error ? cause.message : "An error occurred.",
        });
        return null;
      });
      if (outcome === "empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      }
    },
    [],
  );

  return {
    model: {
      activeThreadId,
      visualActiveThreadId: activeThreadId,
      selectedThreadIds,
      expandedSubagentParentIds,
      renameThreadId,
    },
    actions: {
      activate: activateThreadFromSidebarIntent,
      activateFromClick,
      primeActivation,
      toggleSubagents,
      openRename: setRenameThreadId,
      closeRename: () => setRenameThreadId(null),
      handleRenamePointerUp,
      commitRename,
      clearSelection,
    },
  };
}

export type SidebarThreadInteractionOwner = ReturnType<typeof useSidebarThreadInteractionOwner>;
