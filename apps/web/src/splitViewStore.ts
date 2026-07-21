// FILE: splitViewStore.ts
// Purpose: Stable facade for the persisted split-chat pane-tree store.
// Layer: UI state store
// Exports: pane/split types, tree-aware selectors, and id-based mutation helpers used by sidebar and route surfaces

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  migrateLegacyPersistedState,
  SPLIT_VIEW_STORAGE_KEY,
  SPLIT_VIEW_STORAGE_VERSION,
} from "./split-view-state/splitViewPersistence";
import { createSplitViewState } from "./split-view-state/splitViewStateCreator";
import type { SplitViewStore, SplitViewStoreState } from "./split-view-state/splitViewTypes";

export type {
  LeafPane,
  Pane,
  PaneId,
  SplitDirection,
  SplitDropSide,
  SplitNode,
  SplitView,
  SplitViewId,
  SplitViewPanePanelState,
} from "./split-view-state/splitViewTypes";
export {
  resolvePreferredSplitViewIdForThread,
  resolveSplitViewFocusedPaneThreadId,
  resolveSplitViewFocusedThreadId,
  resolveSplitViewLeaves,
  resolveSplitViewPaneIdForThread,
  resolveSplitViewPaneThreadId,
  resolveSplitViewThreadIds,
  selectSplitView,
  selectSplitViewIdForSourceThread,
} from "./split-view-state/splitViewSelectors";

export const useSplitViewStore = create<SplitViewStore>()(
  persist<SplitViewStore, [], [], SplitViewStoreState>(createSplitViewState, {
    name: SPLIT_VIEW_STORAGE_KEY,
    version: SPLIT_VIEW_STORAGE_VERSION,
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({
      splitViewsById: state.splitViewsById,
      splitViewIdBySourceThreadId: state.splitViewIdBySourceThreadId,
    }),
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...(persistedState as Partial<SplitViewStoreState>),
      hasHydrated: currentState.hasHydrated,
    }),
    onRehydrateStorage: () => {
      return (state) => {
        state?.setHasHydrated(true);
      };
    },
    // Pre-v2 storage used a flat left/right pane shape. Recover it into the recursive tree shape.
    migrate: (persistedState, version) => {
      if (version >= SPLIT_VIEW_STORAGE_VERSION) {
        return persistedState as SplitViewStoreState;
      }
      return (
        migrateLegacyPersistedState(persistedState) ?? {
          splitViewsById: {},
          splitViewIdBySourceThreadId: {},
        }
      );
    },
  }),
);
