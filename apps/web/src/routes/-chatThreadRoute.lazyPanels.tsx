import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { ThreadId } from "@agent-group/contracts";
import { Suspense, lazy, type ReactNode } from "react";

import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { PanelStateMessage } from "../components/chat/PanelStateMessage";
import { getRightDockPaneMeta } from "../components/chat/rightDockPaneMeta";
import type { RightDockPaneKind } from "../rightDockStore.logic";
import type { SplitViewPanePanelState } from "../splitViewStore";

export const DiffPanel = lazy(() => import("../components/DiffPanel"));
export const BrowserPanel = lazy(() => import("../components/BrowserPanel"));
export const PullRequestDockPane = lazy(
  () => import("../components/pullRequest/PullRequestDockPane"),
);
export const EditorWorkspaceView = lazy(() =>
  import("../components/EditorWorkspaceView").then((module) => ({
    default: module.EditorWorkspaceView,
  })),
);
export const DockTerminalPane = lazy(() => import("../components/chat/DockTerminalPane"));
export const GitPanel = lazy(() => import("../components/chat/GitPanel"));
export const DockExplorerPane = lazy(() =>
  import("../components/chat/DockExplorerPane").then((module) => ({
    default: module.DockExplorerPane,
  })),
);
export const DockFilePane = lazy(() =>
  import("../components/chat/DockFilePane").then((module) => ({
    default: module.DockFilePane,
  })),
);
export const AgentGroupContextPane = lazy(() => import("../components/AgentGroupContextPane"));
export const AgentGroupSettingsPane = lazy(() => import("../components/AgentGroupSettingsPane"));
export const HighlightsDockPane = lazy(() =>
  import("../components/highlights/HighlightsDockPane").then((module) => ({
    default: module.HighlightsDockPane,
  })),
);

export const DiffLoadingFallback = (props: { mode: DiffPanelMode; hideHeader?: boolean }) => {
  return (
    <DiffPanelShell
      mode={props.mode}
      header={props.hideHeader ? null : <DiffPanelHeaderSkeleton />}
    >
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

export const LazyDiffPanel = (props: {
  mode: DiffPanelMode;
  threadId?: ThreadId | null;
  panelState?: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  onUpdatePanelState?: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onClosePanel?: () => void;
  liveRefreshEnabled?: boolean;
  queriesEnabled?: boolean;
  hideHeader?: boolean;
  onRenderableFilesChange?: (files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => void;
  onEditorDiffOptionsChange?: (control: ReactNode | null) => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <DiffLoadingFallback
            mode={props.mode}
            {...(props.hideHeader !== undefined ? { hideHeader: props.hideHeader } : {})}
          />
        }
      >
        <DiffPanel
          mode={props.mode}
          {...(props.threadId !== undefined ? { threadId: props.threadId } : {})}
          {...(props.panelState ? { panelState: props.panelState } : {})}
          {...(props.onUpdatePanelState ? { onUpdatePanelState: props.onUpdatePanelState } : {})}
          {...(props.onClosePanel ? { onClosePanel: props.onClosePanel } : {})}
          {...(props.liveRefreshEnabled !== undefined
            ? { liveRefreshEnabled: props.liveRefreshEnabled }
            : {})}
          {...(props.queriesEnabled !== undefined ? { queriesEnabled: props.queriesEnabled } : {})}
          {...(props.hideHeader !== undefined ? { hideHeader: props.hideHeader } : {})}
          {...(props.onRenderableFilesChange
            ? { onRenderableFilesChange: props.onRenderableFilesChange }
            : {})}
          {...(props.onEditorDiffOptionsChange
            ? { onEditorDiffOptionsChange: props.onEditorDiffOptionsChange }
            : {})}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

export function RightDockPanePlaceholder(props: { kind: RightDockPaneKind }) {
  const { label } = getRightDockPaneMeta(props.kind);
  return <PanelStateMessage>{label} panel is coming soon.</PanelStateMessage>;
}

// Embedded dock chats (side chats) manage their own panels through the dock, so the
// nested ChatView always renders with a closed, inert panel state.
export const DOCK_EMBEDDED_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};
