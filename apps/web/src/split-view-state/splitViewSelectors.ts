import type { ThreadId } from "@agent-group/contracts";

import { collectLeaves, findLeafPaneById } from "../splitView.logic";
import type { LeafPane, PaneId, SplitView, SplitViewId, SplitViewStore } from "./splitViewTypes";

// Returns the threadId of the focused leaf, falling back to the first non-empty leaf when the
// focused pane is empty (so the UI never shows an "empty" thread when something is open elsewhere).
export function resolveSplitViewFocusedThreadId(splitView: SplitView): ThreadId | null {
  const focused = findLeafPaneById(splitView.root, splitView.focusedPaneId);
  if (focused?.threadId) {
    return focused.threadId;
  }
  for (const leaf of collectLeaves(splitView.root)) {
    if (leaf.threadId) return leaf.threadId;
  }
  return null;
}

// Strict variant: returns the focused leaf's threadId without any fallback (used for routing handoff).
export function resolveSplitViewFocusedPaneThreadId(splitView: SplitView): ThreadId | null {
  return findLeafPaneById(splitView.root, splitView.focusedPaneId)?.threadId ?? null;
}

export function resolveSplitViewPaneThreadId(
  splitView: SplitView,
  paneId: PaneId,
): ThreadId | null {
  return findLeafPaneById(splitView.root, paneId)?.threadId ?? null;
}

export function resolveSplitViewThreadIds(splitView: SplitView): ThreadId[] {
  const ids = collectLeaves(splitView.root)
    .map((leaf) => leaf.threadId)
    .filter((threadId): threadId is ThreadId => threadId !== null);
  return [...new Set(ids)];
}

export function resolveSplitViewPaneIdForThread(
  splitView: SplitView,
  threadId: ThreadId | null,
): PaneId | null {
  if (!threadId) return null;
  for (const leaf of collectLeaves(splitView.root)) {
    if (leaf.threadId === threadId) return leaf.id;
  }
  return null;
}

export function resolveSplitViewLeaves(splitView: SplitView): LeafPane[] {
  return collectLeaves(splitView.root);
}

export function selectSplitView(splitViewId: SplitViewId | null) {
  return (store: SplitViewStore) =>
    splitViewId ? (store.splitViewsById[splitViewId] ?? null) : null;
}

export function selectSplitViewIdForSourceThread(threadId: ThreadId | null) {
  return (store: SplitViewStore) =>
    threadId ? (store.splitViewIdBySourceThreadId[threadId] ?? null) : null;
}

// Deterministic membership lookup: restore only if a thread has one clear split,
// or if it is the source thread of one split. Ambiguous non-source membership
// falls back to single-chat instead of guessing by recency.
export function resolvePreferredSplitViewIdForThread(input: {
  splitViewsById: Record<SplitViewId, SplitView | undefined>;
  splitViewIdBySourceThreadId: Record<string, SplitViewId | undefined>;
  threadId: ThreadId | null;
}): SplitViewId | null {
  if (!input.threadId) {
    return null;
  }

  const matchingSplitViews = Object.values(input.splitViewsById)
    .filter((splitView): splitView is SplitView => splitView !== undefined)
    .filter((splitView) =>
      collectLeaves(splitView.root).some((leaf) => leaf.threadId === input.threadId),
    );

  const sourceSplitViewId = input.splitViewIdBySourceThreadId[input.threadId] ?? null;
  if (
    sourceSplitViewId &&
    matchingSplitViews.some((splitView) => splitView.id === sourceSplitViewId)
  ) {
    return sourceSplitViewId;
  }

  const onlyMatchingSplitView = matchingSplitViews.length === 1 ? matchingSplitViews[0] : null;
  return onlyMatchingSplitView?.id ?? null;
}
