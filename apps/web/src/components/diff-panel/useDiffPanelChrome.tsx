import type { TurnId } from "@agent-group/contracts";
import { useEffect, useMemo, type ReactNode } from "react";
import type { TimestampFormat } from "../../appSettings";
import { XIcon } from "../../lib/icons";
import { DOCK_HEADER_ICON_BUTTON_CLASS } from "../chat/chatHeaderControls";
import { resolveDiffPanelScopePickerValue } from "../DiffPanel.logic";
import { DiffPanelToolbar } from "../DiffPanelToolbar";
import { IconButton } from "../ui/icon-button";
import { DiffPanelOptionsControl, type DiffPanelOptionsModel } from "./DiffPanelOptionsControl";
import type { DiffPanelActions } from "./useDiffPanelActions";
import type { DiffPanelLocalState } from "./useDiffPanelLocalState";
import type { DiffPanelReviewData } from "./useDiffPanelReviewData";

interface UseDiffPanelChromeInput {
  data: DiffPanelReviewData;
  state: DiffPanelLocalState;
  actions: DiffPanelActions;
  selectedTurnId: TurnId | null;
  selectedFilePath: string | null;
  timestampFormat: TimestampFormat;
  resolvedTheme: "light" | "dark";
  hideHeader: boolean;
  onClosePanel?: (() => void) | undefined;
  onEditorDiffOptionsChange?: ((control: ReactNode | null) => void) | undefined;
}

export function useDiffPanelChrome({
  data,
  state,
  actions,
  selectedTurnId,
  selectedFilePath,
  timestampFormat,
  resolvedTheme,
  hideHeader,
  onClosePanel,
  onEditorDiffOptionsChange,
}: UseDiffPanelChromeInput) {
  const latestTurnId = data.orderedTurnDiffSummaries[0]?.turnId ?? null;
  const scopePickerValue = useMemo(
    () =>
      resolveDiffPanelScopePickerValue({
        viewSource: data.viewSource,
        latestTurnId,
        turnScopeIntent: state.turnScopeIntent,
      }),
    [data.viewSource, latestTurnId, state.turnScopeIntent],
  );
  const optionsModel = useMemo<DiffPanelOptionsModel>(
    () => ({
      source: {
        scopePickerValue,
        scopeFileCounts: data.scopeFileCounts,
        selectedTurnId,
        orderedTurnDiffSummaries: data.orderedTurnDiffSummaries,
        inferredCheckpointTurnCountByTurnId: data.inferredCheckpointTurnCountByTurnId,
        timestampFormat,
      },
      view: {
        diffRenderMode: state.diffRenderMode,
        diffWordWrap: state.diffWordWrap,
        diffIgnoreWhitespace: state.diffIgnoreWhitespace,
        diffCopyText: data.diffCopyText,
        isDiffCopied: actions.isDiffCopied,
      },
      files: {
        renderableFiles: data.renderableFiles,
        allFilesCollapsed: actions.allFilesCollapsed,
      },
      actions: {
        selectRepoScope: actions.selectRepoScope,
        selectAllTurns: actions.selectAllTurns,
        selectLastTurn: actions.selectLastTurn,
        selectTurn: actions.selectTurn,
        setDiffRenderMode: state.setDiffRenderMode,
        setDiffWordWrap: state.setDiffWordWrap,
        setDiffIgnoreWhitespace: state.setDiffIgnoreWhitespace,
        copyDiff: actions.copyDiff,
        toggleCollapseAll: actions.toggleCollapseAll,
      },
    }),
    [
      actions.allFilesCollapsed,
      actions.copyDiff,
      actions.isDiffCopied,
      actions.selectAllTurns,
      actions.selectLastTurn,
      actions.selectRepoScope,
      actions.selectTurn,
      actions.toggleCollapseAll,
      data.diffCopyText,
      data.inferredCheckpointTurnCountByTurnId,
      data.orderedTurnDiffSummaries,
      data.renderableFiles,
      data.scopeFileCounts,
      scopePickerValue,
      selectedTurnId,
      state.diffIgnoreWhitespace,
      state.diffRenderMode,
      state.diffWordWrap,
      state.setDiffIgnoreWhitespace,
      state.setDiffRenderMode,
      state.setDiffWordWrap,
      timestampFormat,
    ],
  );
  const editorDiffOptionsControl = useMemo(
    () => (hideHeader ? <DiffPanelOptionsControl model={optionsModel} /> : null),
    [hideHeader, optionsModel],
  );

  useEffect(() => {
    onEditorDiffOptionsChange?.(editorDiffOptionsControl);
  }, [editorDiffOptionsControl, onEditorDiffOptionsChange]);
  useEffect(
    () => () => {
      onEditorDiffOptionsChange?.(null);
    },
    [onEditorDiffOptionsChange],
  );

  const showDiffToolbar = Boolean(
    data.activeThreadContext && data.isGitRepo && !data.diffEnvironmentPending,
  );
  return useMemo(
    () =>
      hideHeader ? null : showDiffToolbar ? (
        <DiffPanelToolbar
          key={data.activeThreadId ?? "no-thread"}
          activeCwd={data.activeCwd}
          activeThreadId={data.activeThreadId}
          viewSource={data.viewSource}
          turnScopeIntent={state.turnScopeIntent}
          scopeFileCounts={data.scopeFileCounts}
          activeStats={
            data.activePatchStat
              ? {
                  additions: data.activePatchStat.additions,
                  deletions: data.activePatchStat.deletions,
                }
              : null
          }
          orderedTurnDiffSummaries={data.orderedTurnDiffSummaries}
          inferredCheckpointTurnCountByTurnId={data.inferredCheckpointTurnCountByTurnId}
          selectedTurnId={selectedTurnId}
          timestampFormat={timestampFormat}
          renderableFiles={data.renderableFiles}
          selectedFilePath={selectedFilePath}
          fileTreeOpen={state.fileTreeOpen}
          resolvedTheme={resolvedTheme}
          diffRenderMode={state.diffRenderMode}
          diffWordWrap={state.diffWordWrap}
          diffIgnoreWhitespace={state.diffIgnoreWhitespace}
          diffCopyText={data.diffCopyText}
          isDiffCopied={actions.isDiffCopied}
          allFilesCollapsed={actions.allFilesCollapsed}
          onSelectRepoScope={actions.selectRepoScope}
          onSelectAllTurns={actions.selectAllTurns}
          onSelectLastTurn={actions.selectLastTurn}
          onSelectTurn={actions.selectTurn}
          onSelectFile={actions.selectFile}
          onToggleFileTree={state.toggleFileTree}
          onDiffRenderModeChange={state.setDiffRenderMode}
          onDiffWordWrapChange={state.setDiffWordWrap}
          onDiffIgnoreWhitespaceChange={state.setDiffIgnoreWhitespace}
          onCopyDiff={actions.copyDiff}
          onToggleCollapseAll={actions.toggleCollapseAll}
          scopePickerOpen={state.scopePickerOpen}
          onScopePickerOpenChange={state.handleScopePickerOpenChange}
          {...(onClosePanel ? { onClosePanel } : {})}
        />
      ) : onClosePanel ? (
        <div className="flex h-full w-full items-center justify-end px-3 [-webkit-app-region:no-drag]">
          <IconButton
            variant="chrome"
            size="icon-xs"
            label="Close file view"
            className={DOCK_HEADER_ICON_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation();
              onClosePanel();
            }}
          >
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null,
    [
      actions,
      data,
      hideHeader,
      onClosePanel,
      resolvedTheme,
      selectedFilePath,
      selectedTurnId,
      showDiffToolbar,
      state,
      timestampFormat,
    ],
  );
}
