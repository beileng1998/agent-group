// FILE: DiffPanel.tsx
// Purpose: Assembles diff data, interaction, chrome, and rendering owners.
// Layer: Diff panel container

import type { FileDiffMetadata } from "@pierre/diffs/react";
import { ThreadId } from "@agent-group/contracts";
import type { ReactNode } from "react";
import { useAppSettings } from "../appSettings";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import type { SplitViewPanePanelState } from "../splitViewStore";
import { DiffPanelContent } from "./diff-panel/DiffPanelContent";
import { useDiffPanelActions } from "./diff-panel/useDiffPanelActions";
import { useDiffPanelChrome } from "./diff-panel/useDiffPanelChrome";
import {
  useDiffPanelLocalState,
  useDiffPanelLocalStateSync,
} from "./diff-panel/useDiffPanelLocalState";
import { useDiffPanelReviewData } from "./diff-panel/useDiffPanelReviewData";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";

interface DiffPanelProps {
  mode?: DiffPanelMode;
  threadId?: ThreadId | null;
  panelState?: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  onUpdatePanelState?: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onClosePanel?: () => void;
  liveRefreshEnabled?: boolean;
  /** When false, skip git/diff fetches (e.g. right dock collapsed or pane hidden). */
  queriesEnabled?: boolean;
  hideHeader?: boolean;
  onRenderableFilesChange?: (files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => void;
  onEditorDiffOptionsChange?: (control: ReactNode | null) => void;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  threadId: controlledThreadId,
  panelState,
  onUpdatePanelState,
  onClosePanel,
  liveRefreshEnabled = true,
  queriesEnabled = true,
  hideHeader = false,
  onRenderableFilesChange,
  onEditorDiffOptionsChange,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const diffSearch = useDiffRouteSearch();
  const diffOpen = panelState ? panelState.panel === "diff" : diffSearch.diff === "1";
  const selectedTurnId = panelState
    ? (panelState.diffTurnId ?? null)
    : (diffSearch.diffTurnId ?? null);
  const selectedFilePath = panelState
    ? (panelState.diffFilePath ?? null)
    : (diffSearch.diffFilePath ?? null);
  const state = useDiffPanelLocalState({
    diffOpen,
    selectedTurnId,
    defaultWordWrap: settings.diffWordWrap,
  });
  const data = useDiffPanelReviewData({
    controlledThreadId,
    diffOpen,
    queriesEnabled,
    liveRefreshEnabled,
    scopePickerOpen: state.scopePickerOpen,
    selectedTurnId,
    diffViewKind: state.diffViewKind,
    turnScopeIntent: state.turnScopeIntent,
    diffIgnoreWhitespace: state.diffIgnoreWhitespace,
    onRenderableFilesChange,
  });
  useDiffPanelLocalStateSync(state, {
    diffOpen,
    selectedTurnId,
    defaultWordWrap: settings.diffWordWrap,
  });
  const actions = useDiffPanelActions({
    data,
    state,
    diffOpen,
    selectedTurnId,
    selectedFilePath,
    onUpdatePanelState,
  });
  const shellHeader = useDiffPanelChrome({
    data,
    state,
    actions,
    selectedTurnId,
    selectedFilePath,
    timestampFormat: settings.timestampFormat,
    resolvedTheme,
    hideHeader,
    onClosePanel,
    onEditorDiffOptionsChange,
  });

  return (
    <DiffPanelShell mode={mode} header={shellHeader}>
      <DiffPanelContent
        data={data}
        state={state}
        actions={actions}
        selectedFilePath={selectedFilePath}
        resolvedTheme={resolvedTheme}
        hideHeader={hideHeader}
      />
    </DiffPanelShell>
  );
}
