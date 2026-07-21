import type { TurnId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { stripDiffSearchParams } from "../../diffRouteSearch";
import {
  appendChatFileReference,
  appendComposerPromptText,
  buildDiffSelectionReference,
  buildWhyChangedPrompt,
} from "../../lib/chatReferences";
import { buildFileDiffRenderKey } from "../../lib/diffRendering";
import type { RepoDiffScope } from "../../repoDiffScopeStore";
import type { SplitViewPanePanelState } from "../../splitViewStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { closestThroughShadow } from "../chat/chatSelectionActions";
import { useCodeSelectionAction } from "../chat/useCodeSelectionAction";
import { areAllRenderableFilesCollapsed, isStaleDiffTurnSelection } from "../DiffPanel.logic";
import type { DiffPanelLocalState } from "./useDiffPanelLocalState";
import type { DiffPanelReviewData } from "./useDiffPanelReviewData";

interface UseDiffPanelActionsInput {
  data: DiffPanelReviewData;
  state: DiffPanelLocalState;
  diffOpen: boolean;
  selectedTurnId: TurnId | null;
  selectedFilePath: string | null;
  onUpdatePanelState?:
    | ((
        patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
      ) => void)
    | undefined;
}

export function useDiffPanelActions({
  data,
  state,
  diffOpen,
  selectedTurnId,
  selectedFilePath,
  onUpdatePanelState,
}: UseDiffPanelActionsInput) {
  const navigate = useNavigate();
  const { copyToClipboard: copyDiffToClipboard, isCopied: isDiffCopied } = useCopyToClipboard();

  useEffect(() => {
    if (!selectedFilePath || !state.patchViewportRef.current) return;
    const target = Array.from(
      state.patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  }, [data.renderableFiles, selectedFilePath, state.patchViewportRef]);

  const toggleFileCollapsed = useCallback(
    (fileKey: string) => {
      state.setCollapsedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(fileKey)) next.delete(fileKey);
        else next.add(fileKey);
        return next;
      });
    },
    [state.setCollapsedFiles],
  );
  const diffFileChatActions = useMemo(
    () =>
      data.activeThreadId
        ? {
            onReferenceInChat: (filePath: string) => {
              appendChatFileReference(data.activeThreadId!, { path: filePath });
            },
            onAskWhyChanged: (filePath: string) => {
              appendComposerPromptText(data.activeThreadId!, buildWhyChangedPrompt(filePath));
            },
          }
        : undefined,
    [data.activeThreadId],
  );
  const readDiffSelection = useCallback((container: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const anchorRow = closestThroughShadow(selection.anchorNode, "[data-diff-file-path]");
    const focusRow = closestThroughShadow(selection.focusNode, "[data-diff-file-path]");
    if (!anchorRow || anchorRow !== focusRow || !container.contains(anchorRow)) return null;
    const filePath = anchorRow.getAttribute("data-diff-file-path") ?? "";
    const text = selection
      .toString()
      .replace(/\r\n/g, "\n")
      .replace(/^\n+|\n+$/g, "")
      .trim();
    return filePath.length > 0 && text.length > 0 ? { filePath, text } : null;
  }, []);
  const commitDiffSelection = useCallback(
    (payload: { filePath: string; text: string }) => {
      if (data.activeThreadId) {
        appendComposerPromptText(
          data.activeThreadId,
          buildDiffSelectionReference(payload.filePath, payload.text),
        );
      }
    },
    [data.activeThreadId],
  );
  const diffSelectionAction = useCodeSelectionAction({
    enabled: data.activeThreadId !== null,
    readSelection: readDiffSelection,
    onCommit: commitDiffSelection,
  });
  const updateDiffSelection = useCallback(
    (input: { turnId: TurnId | null; filePath?: string | null }) => {
      if (!data.activeThreadContext) return;
      if (onUpdatePanelState) {
        onUpdatePanelState({
          panel: "diff",
          diffTurnId: input.turnId,
          diffFilePath: input.filePath ?? null,
        });
        return;
      }
      void navigate({
        to: "/$threadId",
        params: { threadId: data.activeThreadContext.id },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return {
            ...rest,
            panel: "diff",
            diff: "1",
            ...(input.turnId ? { diffTurnId: input.turnId } : {}),
            ...(input.filePath ? { diffFilePath: input.filePath } : {}),
          };
        },
      });
    },
    [data.activeThreadContext, navigate, onUpdatePanelState],
  );

  useEffect(() => {
    if (
      diffOpen &&
      data.activeThreadContext &&
      isStaleDiffTurnSelection(selectedTurnId, data.orderedTurnDiffSummaries)
    ) {
      updateDiffSelection({ turnId: null, filePath: null });
    }
  }, [
    data.activeThreadContext,
    data.orderedTurnDiffSummaries,
    diffOpen,
    selectedTurnId,
    updateDiffSelection,
  ]);
  const selectTurn = useCallback(
    (turnId: TurnId | null) => {
      state.setDiffViewKind("turn");
      state.setTurnScopeIntent(turnId === null ? "all" : "last");
      updateDiffSelection({ turnId, filePath: null });
    },
    [state.setDiffViewKind, state.setTurnScopeIntent, updateDiffSelection],
  );
  const selectRepoScope = useCallback(
    (scope: RepoDiffScope) => {
      state.setDiffViewKind("repo");
      data.setRepoDiffScope(scope);
      if (selectedTurnId !== null) updateDiffSelection({ turnId: null, filePath: null });
    },
    [data.setRepoDiffScope, selectedTurnId, state.setDiffViewKind, updateDiffSelection],
  );
  const selectAllTurns = useCallback(() => {
    state.setTurnScopeIntent("all");
    selectTurn(null);
  }, [selectTurn, state.setTurnScopeIntent]);
  const selectLastTurn = useCallback(() => {
    const latestTurn = data.orderedTurnDiffSummaries[0];
    state.setTurnScopeIntent("last");
    state.setDiffViewKind("turn");
    if (!latestTurn) {
      if (selectedTurnId !== null) updateDiffSelection({ turnId: null, filePath: null });
      return;
    }
    selectTurn(latestTurn.turnId);
  }, [
    data.orderedTurnDiffSummaries,
    selectTurn,
    selectedTurnId,
    state.setDiffViewKind,
    state.setTurnScopeIntent,
    updateDiffSelection,
  ]);
  const toggleCollapseAll = useCallback(() => {
    state.setCollapsedFiles((previous) => {
      if (areAllRenderableFilesCollapsed(data.renderableFiles, previous)) return new Set();
      return new Set(data.renderableFiles.map(buildFileDiffRenderKey));
    });
  }, [data.renderableFiles, state.setCollapsedFiles]);
  const selectFile = useCallback(
    (filePath: string) => updateDiffSelection({ turnId: selectedTurnId, filePath }),
    [selectedTurnId, updateDiffSelection],
  );
  const allFilesCollapsed = useMemo(
    () => areAllRenderableFilesCollapsed(data.renderableFiles, state.collapsedFiles),
    [data.renderableFiles, state.collapsedFiles],
  );
  const copyDiff = useCallback(() => {
    if (data.diffCopyText) copyDiffToClipboard(data.diffCopyText, undefined);
  }, [copyDiffToClipboard, data.diffCopyText]);

  return {
    toggleFileCollapsed,
    diffFileChatActions,
    diffSelectionAction,
    selectTurn,
    selectRepoScope,
    selectAllTurns,
    selectLastTurn,
    toggleCollapseAll,
    selectFile,
    allFilesCollapsed,
    copyDiff,
    isDiffCopied,
  };
}

export type DiffPanelActions = ReturnType<typeof useDiffPanelActions>;
