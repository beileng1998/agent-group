import { disclosureWidthClassName } from "../../lib/disclosureMotion";
import { REPO_DIFF_SCOPE_LABELS } from "../../repoDiffScopeStore";
import { TranscriptSelectionAction } from "../chat/TranscriptSelectionAction";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import { DiffPanelPatchViewport } from "../DiffPanelPatchViewport";
import { ReviewFileTreePanel } from "../ReviewFileTreePanel";
import type { DiffPanelActions } from "./useDiffPanelActions";
import type { DiffPanelLocalState } from "./useDiffPanelLocalState";
import type { DiffPanelReviewData } from "./useDiffPanelReviewData";

interface DiffPanelContentProps {
  data: DiffPanelReviewData;
  state: DiffPanelLocalState;
  actions: DiffPanelActions;
  selectedFilePath: string | null;
  resolvedTheme: "light" | "dark";
  hideHeader: boolean;
}

export function DiffPanelContent({
  data,
  state,
  actions,
  selectedFilePath,
  resolvedTheme,
  hideHeader,
}: DiffPanelContentProps) {
  if (!data.activeThreadContext) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        Select a thread to inspect turn diffs.
      </PanelStateMessage>
    );
  }
  if (data.gitRepoStatus === false) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        Turn diffs are unavailable because this project is not a git repository.
      </PanelStateMessage>
    );
  }
  if (data.gitRepoStatusError) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        {data.gitRepoStatusError}
      </PanelStateMessage>
    );
  }
  if (data.gitRepoStatus === undefined && data.diffQueriesEnabled && data.activeCwd) {
    return <DiffPanelLoadingState label="Checking git repository..." />;
  }
  if (data.diffEnvironmentPending) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        This chat environment is still being prepared. Diffs will be available once the worktree is
        ready.
      </PanelStateMessage>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        ref={state.patchViewportRef}
        className="diff-panel-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onMouseUp={actions.diffSelectionAction.onContainerMouseUp}
      >
        <DiffPanelPatchViewport
          renderablePatch={data.renderablePatch}
          renderableFiles={data.renderableFiles}
          resolvedTheme={resolvedTheme}
          diffRenderMode={state.diffRenderMode}
          diffWordWrap={state.diffWordWrap}
          workspaceRoot={data.activeCwd ?? null}
          collapsedFiles={state.collapsedFiles}
          onToggleFileCollapsed={actions.toggleFileCollapsed}
          chatActions={actions.diffFileChatActions}
          isLoading={data.activeReviewIsLoading}
          hasNoChanges={data.activeReviewHasNoChanges}
          error={data.activeReviewError}
          viewKind={state.diffViewKind}
          loadingLabel={
            state.diffViewKind === "repo"
              ? `Loading ${REPO_DIFF_SCOPE_LABELS[data.repoDiffScope].toLowerCase()} diff...`
              : "Loading checkpoint diff..."
          }
          emptyLabel={
            state.diffViewKind === "repo"
              ? "No changes in the selected diff source."
              : data.orderedTurnDiffSummaries.length === 0
                ? "No turn diffs are available yet."
                : "No net changes in this selection."
          }
          unavailableLabel="No repo diff is available right now."
        />
        {actions.diffSelectionAction.pendingAction ? (
          <TranscriptSelectionAction
            left={actions.diffSelectionAction.pendingAction.left}
            top={actions.diffSelectionAction.pendingAction.top}
            placement={actions.diffSelectionAction.pendingAction.placement}
            onAddToChat={actions.diffSelectionAction.commit}
          />
        ) : null}
      </div>
      {hideHeader ? null : (
        <div
          className={disclosureWidthClassName(state.fileTreeOpen, "w-[min(42%,28rem)]", "shrink-0")}
          aria-hidden={!state.fileTreeOpen}
          inert={!state.fileTreeOpen}
        >
          {state.fileTreeMounted ? (
            <ReviewFileTreePanel
              files={data.renderableFiles}
              selectedFilePath={selectedFilePath}
              resolvedTheme={resolvedTheme}
              isLoading={data.activeReviewIsLoading}
              onSelectFile={actions.selectFile}
              onClose={state.closeFileTree}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
