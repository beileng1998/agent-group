import type { LegacySplitViewLike } from "../splitView.logic";
import { isLegacySplitViewLike } from "../splitView.logic";
import { randomUUID } from "../lib/utils";
import { createSplitNode } from "./splitViewModel";
import type { LeafPane, SplitView, SplitViewId, SplitViewStoreState } from "./splitViewTypes";

// Keep the v1 suffix stable while using the Agent Group namespace; legacy payloads flow through the
// v1 -> v2 schema migration below.
export const SPLIT_VIEW_STORAGE_KEY = "agent-group:split-view-state:v1";
export const SPLIT_VIEW_STORAGE_VERSION = 2;

function migrateLegacySplitView(legacy: LegacySplitViewLike): SplitView | null {
  const now = new Date().toISOString();
  const leftLeaf: LeafPane = {
    kind: "leaf",
    id: randomUUID(),
    threadId: legacy.leftThreadId ?? null,
    panel: { ...legacy.leftPanel },
  };
  const rightLeaf: LeafPane = {
    kind: "leaf",
    id: randomUUID(),
    threadId: legacy.rightThreadId ?? null,
    panel: { ...legacy.rightPanel },
  };

  if (!leftLeaf.threadId && !rightLeaf.threadId) {
    return null;
  }

  const root = createSplitNode({
    direction: "horizontal",
    first: leftLeaf,
    second: rightLeaf,
    ratio: legacy.ratio,
  });
  return {
    id: legacy.id,
    sourceThreadId: legacy.sourceThreadId,
    ownerProjectId: legacy.ownerProjectId,
    root,
    focusedPaneId: legacy.focusedPane === "right" ? rightLeaf.id : leftLeaf.id,
    createdAt: legacy.createdAt ?? now,
    updatedAt: legacy.updatedAt ?? now,
  };
}

export function migrateLegacyPersistedState(state: unknown): SplitViewStoreState | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const legacyMap = (state as { splitViewsById?: Record<string, unknown> }).splitViewsById;
  if (!legacyMap || typeof legacyMap !== "object") {
    return null;
  }
  const splitViewsById: Record<SplitViewId, SplitView | undefined> = {};
  const splitViewIdBySourceThreadId: Record<string, SplitViewId | undefined> = {};

  for (const [splitViewId, value] of Object.entries(legacyMap)) {
    if (!isLegacySplitViewLike(value)) {
      continue;
    }
    const migrated = migrateLegacySplitView(value);
    if (!migrated) {
      continue;
    }
    splitViewsById[splitViewId] = migrated;
    splitViewIdBySourceThreadId[migrated.sourceThreadId] = splitViewId;
  }

  return {
    splitViewsById,
    splitViewIdBySourceThreadId,
  };
}
