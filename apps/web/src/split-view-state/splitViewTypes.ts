import type { ProjectId, ThreadId, TurnId } from "@agent-group/contracts";

import type { ChatRightPanel } from "../diffRouteSearch";

export type SplitViewId = string;
export type PaneId = string;
export type SplitDirection = "horizontal" | "vertical";

// "first" maps to the top/left side of a split; "second" maps to the bottom/right side.
export type SplitDropSide = "first" | "second";

export interface SplitViewPanePanelState {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
  lastOpenPanel: ChatRightPanel;
}

export interface LeafPane {
  kind: "leaf";
  id: PaneId;
  threadId: ThreadId | null;
  panel: SplitViewPanePanelState;
}

export interface SplitNode {
  kind: "split";
  id: PaneId;
  direction: SplitDirection;
  // first = left (horizontal) | top (vertical); second = right | bottom.
  first: Pane;
  second: Pane;
  ratio: number;
}

export type Pane = LeafPane | SplitNode;

export interface SplitView {
  id: SplitViewId;
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
  root: Pane;
  focusedPaneId: PaneId;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFromThreadInput {
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
}

export interface CreateFromDropInput {
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
  droppedThreadId: ThreadId;
  direction: SplitDirection;
  side: SplitDropSide;
}

export interface DropThreadOnPaneInput {
  splitViewId: SplitViewId;
  targetPaneId: PaneId;
  direction: SplitDirection;
  side: SplitDropSide;
  threadId: ThreadId;
}

export interface RemovePaneFromSplitViewInput {
  splitViewId: SplitViewId;
  paneId: PaneId;
}

export interface SplitViewStore {
  hasHydrated: boolean;
  splitViewsById: Record<SplitViewId, SplitView | undefined>;
  splitViewIdBySourceThreadId: Record<string, SplitViewId | undefined>;
  createFromThread: (input: CreateFromThreadInput) => SplitViewId;
  createFromDrop: (input: CreateFromDropInput) => SplitViewId;
  removeSplitView: (splitViewId: SplitViewId) => void;
  replacePaneThread: (splitViewId: SplitViewId, paneId: PaneId, threadId: ThreadId | null) => void;
  dropThreadOnPane: (input: DropThreadOnPaneInput) => boolean;
  removePaneFromSplitView: (input: RemovePaneFromSplitViewInput) => boolean;
  setFocusedPane: (splitViewId: SplitViewId, paneId: PaneId) => void;
  setRatioForNode: (splitViewId: SplitViewId, splitNodeId: PaneId, ratio: number) => void;
  setPanePanelState: (
    splitViewId: SplitViewId,
    paneId: PaneId,
    patch: Partial<SplitViewPanePanelState>,
  ) => void;
  removeThreadFromSplitViews: (threadId: ThreadId) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export type SplitViewStoreState = Pick<
  SplitViewStore,
  "splitViewsById" | "splitViewIdBySourceThreadId"
>;
