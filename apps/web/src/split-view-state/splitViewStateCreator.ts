import type { ThreadId } from "@agent-group/contracts";
import type { StateCreator } from "zustand";

import {
  canSubdividePane,
  collectLeaves,
  findLeafPaneById,
  findSplitNodeById,
  removeLeafByPaneId,
  removeLeafByThreadId as removeLeafByThreadIdInTree,
  replacePaneInTree,
  resolveDefaultFocusLeafId,
} from "../splitView.logic";
import {
  buildSplitViewFromDrop,
  buildSplitViewFromThread,
  clampRatio,
  createLeafPane,
  createSplitNode,
} from "./splitViewModel";
import {
  resolveNextSourceThreadId,
  resolveUpdatedAt,
  updateSplitView,
} from "./splitViewStateHelpers";
import type {
  LeafPane,
  SplitNode,
  SplitViewPanePanelState,
  SplitViewStore,
} from "./splitViewTypes";

export const createSplitViewState: StateCreator<
  SplitViewStore,
  [["zustand/persist", unknown]],
  []
> = (set, get) => ({
  hasHydrated: false,
  splitViewsById: {},
  splitViewIdBySourceThreadId: {},
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
  createFromThread: (input) => {
    const existingId = get().splitViewIdBySourceThreadId[input.sourceThreadId] ?? null;
    if (existingId) {
      return existingId;
    }

    const splitView = buildSplitViewFromThread(input);
    set((state) => ({
      splitViewsById: {
        ...state.splitViewsById,
        [splitView.id]: splitView,
      },
      splitViewIdBySourceThreadId: {
        ...state.splitViewIdBySourceThreadId,
        [input.sourceThreadId]: splitView.id,
      },
    }));
    return splitView.id;
  },
  createFromDrop: (input) => {
    const existingId = get().splitViewIdBySourceThreadId[input.sourceThreadId] ?? null;
    const existing = existingId ? (get().splitViewsById[existingId] ?? null) : null;
    const splitView = buildSplitViewFromDrop(input, existing);
    set((state) => ({
      splitViewsById: {
        ...state.splitViewsById,
        [splitView.id]: splitView,
      },
      splitViewIdBySourceThreadId: {
        ...state.splitViewIdBySourceThreadId,
        [input.sourceThreadId]: splitView.id,
      },
    }));
    return splitView.id;
  },
  removeSplitView: (splitViewId) =>
    set((state) => {
      const existing = state.splitViewsById[splitViewId];
      if (!existing) return state;
      const nextSplitViewsById = { ...state.splitViewsById };
      const nextSplitViewIdBySourceThreadId = { ...state.splitViewIdBySourceThreadId };
      delete nextSplitViewsById[splitViewId];
      delete nextSplitViewIdBySourceThreadId[existing.sourceThreadId];
      return {
        splitViewsById: nextSplitViewsById,
        splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
      };
    }),
  replacePaneThread: (splitViewId, paneId, threadId) =>
    set((state) => {
      const existing = state.splitViewsById[splitViewId];
      if (!existing) return state;
      let nextSourceThreadId: ThreadId | null = existing.sourceThreadId;
      let shouldRemoveSplitView = false;
      const nextState = updateSplitView(state, splitViewId, (splitView) => {
        const leaf = findLeafPaneById(splitView.root, paneId);
        if (!leaf) return splitView;
        if (leaf.threadId === threadId) return splitView;
        const nextLeaf: LeafPane = { ...leaf, threadId };
        const nextRoot = replacePaneInTree(splitView.root, paneId, nextLeaf);
        const hasAnyThread = collectLeaves(nextRoot).some(
          (candidateLeaf) => candidateLeaf.threadId !== null,
        );
        if (!hasAnyThread) {
          shouldRemoveSplitView = true;
        }
        if (leaf.threadId === splitView.sourceThreadId) {
          nextSourceThreadId = resolveNextSourceThreadId({
            root: nextRoot,
            splitViewId,
            splitViewIdBySourceThreadId: state.splitViewIdBySourceThreadId,
          });
          if (nextSourceThreadId === null) {
            shouldRemoveSplitView = true;
          }
        }
        return {
          ...splitView,
          sourceThreadId: nextSourceThreadId ?? splitView.sourceThreadId,
          root: nextRoot,
          updatedAt: resolveUpdatedAt(),
        };
      });
      if (nextState === state) return state;

      if (shouldRemoveSplitView) {
        const nextSplitViewsById = { ...nextState.splitViewsById };
        const nextSplitViewIdBySourceThreadId = { ...nextState.splitViewIdBySourceThreadId };
        delete nextSplitViewsById[splitViewId];
        if (nextSplitViewIdBySourceThreadId[existing.sourceThreadId] === splitViewId) {
          delete nextSplitViewIdBySourceThreadId[existing.sourceThreadId];
        }
        return {
          splitViewsById: nextSplitViewsById,
          splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
        };
      }

      const updated = nextState.splitViewsById[splitViewId];
      if (
        !updated ||
        nextSourceThreadId === null ||
        nextSourceThreadId === existing.sourceThreadId
      ) {
        return nextState;
      }

      const nextSplitViewIdBySourceThreadId = { ...nextState.splitViewIdBySourceThreadId };
      if (nextSplitViewIdBySourceThreadId[existing.sourceThreadId] === splitViewId) {
        delete nextSplitViewIdBySourceThreadId[existing.sourceThreadId];
      }
      nextSplitViewIdBySourceThreadId[nextSourceThreadId] = splitViewId;
      return {
        ...nextState,
        splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
      };
    }),
  dropThreadOnPane: ({ splitViewId, targetPaneId, direction, side, threadId }) => {
    const stateBefore = get();
    const splitView = stateBefore.splitViewsById[splitViewId];
    if (!splitView) return false;
    const targetLeaf = findLeafPaneById(splitView.root, targetPaneId);
    if (!targetLeaf) return false;
    if (collectLeaves(splitView.root).some((leaf) => leaf.threadId === threadId)) {
      return false;
    }
    if (!canSubdividePane(splitView.root, targetPaneId, direction)) {
      return false;
    }

    const newLeaf = createLeafPane(threadId);
    const newSplit = createSplitNode(
      side === "first"
        ? { direction, first: newLeaf, second: targetLeaf }
        : { direction, first: targetLeaf, second: newLeaf },
    );

    set((state) =>
      updateSplitView(state, splitViewId, (current) => ({
        ...current,
        root: replacePaneInTree(current.root, targetPaneId, newSplit),
        focusedPaneId: newLeaf.id,
        updatedAt: resolveUpdatedAt(),
      })),
    );
    return true;
  },
  removePaneFromSplitView: ({ splitViewId, paneId }) => {
    const stateBefore = get();
    const splitView = stateBefore.splitViewsById[splitViewId];
    if (!splitView) return false;
    const targetLeaf = findLeafPaneById(splitView.root, paneId);
    if (!targetLeaf) return false;

    set((state) => {
      const current = state.splitViewsById[splitViewId];
      if (!current) return state;
      const currentTargetLeaf = findLeafPaneById(current.root, paneId);
      if (!currentTargetLeaf) return state;

      const result = removeLeafByPaneId(current.root, paneId);
      if (result.removedLeafIds.length === 0) return state;
      const nextSplitViewsById = { ...state.splitViewsById };
      const nextSplitViewIdBySourceThreadId = { ...state.splitViewIdBySourceThreadId };

      if (current.sourceThreadId === currentTargetLeaf.threadId) {
        delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
      }

      if (!result.nextRoot) {
        delete nextSplitViewsById[splitViewId];
        delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
        return {
          splitViewsById: nextSplitViewsById,
          splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
        };
      }

      const hasAnyThread = collectLeaves(result.nextRoot).some((leaf) => leaf.threadId !== null);
      if (!hasAnyThread) {
        delete nextSplitViewsById[splitViewId];
        delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
        return {
          splitViewsById: nextSplitViewsById,
          splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
        };
      }

      const nextSourceThreadId =
        current.sourceThreadId === currentTargetLeaf.threadId
          ? resolveNextSourceThreadId({
              root: result.nextRoot,
              splitViewId,
              splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
            })
          : current.sourceThreadId;
      if (!nextSourceThreadId) {
        delete nextSplitViewsById[splitViewId];
        return {
          splitViewsById: nextSplitViewsById,
          splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
        };
      }
      if (nextSourceThreadId !== current.sourceThreadId) {
        nextSplitViewIdBySourceThreadId[nextSourceThreadId] = splitViewId;
      }

      const focusedStillPresent = !result.removedLeafIds.includes(current.focusedPaneId);
      nextSplitViewsById[splitViewId] = {
        ...current,
        sourceThreadId: nextSourceThreadId,
        root: result.nextRoot,
        focusedPaneId: focusedStillPresent
          ? current.focusedPaneId
          : resolveDefaultFocusLeafId(result.nextRoot),
        updatedAt: resolveUpdatedAt(),
      };
      return {
        splitViewsById: nextSplitViewsById,
        splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
      };
    });
    return true;
  },
  setFocusedPane: (splitViewId, paneId) =>
    set((state) =>
      updateSplitView(state, splitViewId, (splitView) => {
        if (splitView.focusedPaneId === paneId) return splitView;
        if (!findLeafPaneById(splitView.root, paneId)) return splitView;
        return {
          ...splitView,
          focusedPaneId: paneId,
          updatedAt: resolveUpdatedAt(),
        };
      }),
    ),
  setRatioForNode: (splitViewId, splitNodeId, ratio) =>
    set((state) =>
      updateSplitView(state, splitViewId, (splitView) => {
        const node = findSplitNodeById(splitView.root, splitNodeId);
        if (!node) return splitView;
        const nextRatio = clampRatio(ratio);
        if (node.ratio === nextRatio) return splitView;
        const nextNode: SplitNode = { ...node, ratio: nextRatio };
        return {
          ...splitView,
          root: replacePaneInTree(splitView.root, splitNodeId, nextNode),
          updatedAt: resolveUpdatedAt(),
        };
      }),
    ),
  setPanePanelState: (splitViewId, paneId, patch) =>
    set((state) =>
      updateSplitView(state, splitViewId, (splitView) => {
        const leaf = findLeafPaneById(splitView.root, paneId);
        if (!leaf) return splitView;
        const nextPanel: SplitViewPanePanelState = { ...leaf.panel, ...patch };
        if (
          leaf.panel.panel === nextPanel.panel &&
          leaf.panel.diffTurnId === nextPanel.diffTurnId &&
          leaf.panel.diffFilePath === nextPanel.diffFilePath &&
          leaf.panel.hasOpenedPanel === nextPanel.hasOpenedPanel &&
          leaf.panel.lastOpenPanel === nextPanel.lastOpenPanel
        ) {
          return splitView;
        }
        const nextLeaf: LeafPane = { ...leaf, panel: nextPanel };
        return {
          ...splitView,
          root: replacePaneInTree(splitView.root, paneId, nextLeaf),
          updatedAt: resolveUpdatedAt(),
        };
      }),
    ),
  removeThreadFromSplitViews: (threadId) =>
    set((state) => {
      let didChange = false;
      const nextSplitViewsById = { ...state.splitViewsById };
      const nextSplitViewIdBySourceThreadId = { ...state.splitViewIdBySourceThreadId };

      for (const [splitViewId, splitView] of Object.entries(state.splitViewsById)) {
        if (!splitView) continue;
        const result = removeLeafByThreadIdInTree(splitView.root, threadId);
        if (result.removedLeafIds.length === 0) continue;

        didChange = true;
        if (result.nextRoot === null) {
          delete nextSplitViewsById[splitViewId];
          delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
          continue;
        }
        if (!collectLeaves(result.nextRoot).some((leaf) => leaf.threadId !== null)) {
          delete nextSplitViewsById[splitViewId];
          delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
          continue;
        }

        const focusedStillPresent = !result.removedLeafIds.includes(splitView.focusedPaneId);
        const nextFocusedPaneId = focusedStillPresent
          ? splitView.focusedPaneId
          : resolveDefaultFocusLeafId(result.nextRoot);
        const nextSourceThreadId =
          splitView.sourceThreadId === threadId
            ? resolveNextSourceThreadId({
                root: result.nextRoot,
                splitViewId,
                splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
              })
            : splitView.sourceThreadId;

        if (splitView.sourceThreadId === threadId) {
          delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
        }
        if (!nextSourceThreadId) {
          delete nextSplitViewsById[splitViewId];
          continue;
        }
        if (nextSourceThreadId !== splitView.sourceThreadId) {
          nextSplitViewIdBySourceThreadId[nextSourceThreadId] = splitViewId;
        }

        nextSplitViewsById[splitViewId] = {
          ...splitView,
          sourceThreadId: nextSourceThreadId,
          root: result.nextRoot,
          focusedPaneId: nextFocusedPaneId,
          updatedAt: resolveUpdatedAt(),
        };
      }

      if (!didChange) return state;
      return {
        splitViewsById: nextSplitViewsById,
        splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
      };
    }),
});
