import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ThreadId, type TurnId } from "@agent-group/contracts";
import { useEffect, useMemo } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  gitBranchesQueryOptions,
  gitStatusQueryOptions,
  gitWorkingTreeDiffQueryOptions,
} from "../../lib/gitReactQuery";
import {
  checkpointDiffQueryOptions,
  resolveCheckpointDiffQueryDisplayState,
} from "../../lib/providerReactQuery";
import {
  getRenderablePatch,
  resolveDiffCopyText,
  sortFileDiffsByPath,
  summarizePatchTotals,
  summarizeRenderablePatchStats,
} from "../../lib/diffRendering";
import { resolveDiffEnvironmentState } from "../../lib/threadEnvironment";
import { type RepoDiffScope, useRepoDiffScopeStore } from "../../repoDiffScopeStore";
import { inferCheckpointTurnCountByTurnId } from "../../session-logic";
import { useStore } from "../../store";
import { createProjectSelector } from "../../storeSelectors";
import {
  resolveConversationCacheScope,
  resolveDiffPanelGitStatusQueriesEnabled,
  resolveDiffPanelQueriesEnabled,
  resolveDiffPanelRepoLiveRefetchIntervalMs,
  resolveDiffPanelScopeCountQueriesEnabled,
  resolveDiffPanelScopeFileCounts,
  resolveDiffPanelThread,
  resolveDiffPanelViewSource,
  resolveSelectedTurnSummary,
  type DiffPanelTurnScopeIntent,
  type DiffViewKind,
} from "../DiffPanel.logic";
import {
  createDiffPanelRepoLiveRefreshSelector,
  createDiffPanelThreadCatalogSelector,
  toDiffPanelThreadCatalog,
  type DiffPanelThreadCatalog,
} from "../diffPanelSelectors";

interface UseDiffPanelReviewDataInput {
  controlledThreadId: ThreadId | null | undefined;
  diffOpen: boolean;
  queriesEnabled: boolean;
  liveRefreshEnabled: boolean;
  scopePickerOpen: boolean;
  selectedTurnId: TurnId | null;
  diffViewKind: DiffViewKind;
  turnScopeIntent: DiffPanelTurnScopeIntent;
  diffIgnoreWhitespace: boolean;
  onRenderableFilesChange?:
    | ((files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => void)
    | undefined;
}

export function useDiffPanelReviewData({
  controlledThreadId,
  diffOpen,
  queriesEnabled,
  liveRefreshEnabled,
  scopePickerOpen,
  selectedTurnId,
  diffViewKind,
  turnScopeIntent,
  diffIgnoreWhitespace,
  onRenderableFilesChange,
}: UseDiffPanelReviewDataInput) {
  const repoDiffScope = useRepoDiffScopeStore((store) => store.scope);
  const setRepoDiffScope = useRepoDiffScopeStore((store) => store.setScope);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThreadId = controlledThreadId ?? routeThreadId;
  const diffQueriesEnabled = useMemo(
    () => resolveDiffPanelQueriesEnabled({ diffOpen, queriesEnabled }),
    [diffOpen, queriesEnabled],
  );
  const scopeCountQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelScopeCountQueriesEnabled({
        queriesEnabled: diffQueriesEnabled,
        scopePickerOpen,
      }),
    [diffQueriesEnabled, scopePickerOpen],
  );
  const serverThreadCatalog = useStore(
    useMemo(() => createDiffPanelThreadCatalogSelector(activeThreadId), [activeThreadId]),
  );
  const shouldPollRepoDiff = useStore(
    useMemo(() => createDiffPanelRepoLiveRefreshSelector(activeThreadId), [activeThreadId]),
  );
  const draftThread = useComposerDraftStore((store) =>
    activeThreadId ? (store.draftThreadsByThreadId[activeThreadId] ?? null) : null,
  );
  const fallbackDraftProjectId = draftThread?.projectId ?? null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelector(fallbackDraftProjectId), [fallbackDraftProjectId]),
  );
  const activeThreadContext = useMemo((): DiffPanelThreadCatalog | undefined => {
    if (serverThreadCatalog) return serverThreadCatalog;
    const draftBackedThread = resolveDiffPanelThread({
      threadId: activeThreadId,
      serverThread: undefined,
      draftThread,
      fallbackModelSelection: fallbackDraftProject?.defaultModelSelection ?? null,
    });
    return draftBackedThread ? toDiffPanelThreadCatalog(draftBackedThread) : undefined;
  }, [
    activeThreadId,
    draftThread,
    fallbackDraftProject?.defaultModelSelection,
    serverThreadCatalog,
  ]);
  const activeProjectId = activeThreadContext?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const diffEnvironmentState = resolveDiffEnvironmentState({
    projectCwd: activeProject?.cwd ?? null,
    envMode: serverThreadCatalog?.envMode ?? draftThread?.envMode ?? activeThreadContext?.envMode,
    worktreePath:
      serverThreadCatalog?.worktreePath ??
      draftThread?.worktreePath ??
      activeThreadContext?.worktreePath ??
      null,
  });
  const diffEnvironmentPending = diffEnvironmentState.pending;
  const activeCwd = diffEnvironmentState.cwd;
  const gitStatusQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelGitStatusQueriesEnabled({
        queriesEnabled: diffQueriesEnabled,
        activeCwd,
        diffViewKind,
      }),
    [activeCwd, diffQueriesEnabled, diffViewKind],
  );
  const gitBranchesQuery = useQuery({
    ...gitBranchesQueryOptions(activeCwd ?? null),
    enabled: diffQueriesEnabled && activeCwd !== null,
  });
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions(activeCwd ?? null),
    enabled: gitStatusQueriesEnabled,
  });
  const gitRepoStatus = gitBranchesQuery.isSuccess ? gitBranchesQuery.data.isRepo : undefined;
  const gitRepoStatusError =
    gitBranchesQuery.error instanceof Error
      ? gitBranchesQuery.error.message
      : gitBranchesQuery.error
        ? "Failed to check git repository."
        : null;
  const isGitRepo = gitRepoStatus === true;
  const turnDiffSummaries = activeThreadContext?.turnDiffSummaries ?? [];
  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        return leftCount === rightCount
          ? right.completedAt.localeCompare(left.completedAt)
          : rightCount - leftCount;
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );
  const selectedTurn = useMemo(
    () => resolveSelectedTurnSummary(selectedTurnId, orderedTurnDiffSummaries),
    [orderedTurnDiffSummaries, selectedTurnId],
  );
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) return undefined;
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const activeCheckpointRange = selectedTurn
    ? typeof selectedCheckpointTurnCount === "number"
      ? {
          fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
          toTurnCount: selectedCheckpointTurnCount,
        }
      : null
    : turnScopeIntent !== "last" && typeof conversationCheckpointTurnCount === "number"
      ? { fromTurnCount: 0, toTurnCount: conversationCheckpointTurnCount }
      : null;
  const conversationCacheScope = useMemo(
    () =>
      selectedTurn || orderedTurnDiffSummaries.length === 0
        ? null
        : resolveConversationCacheScope(conversationCheckpointTurnCount),
    [conversationCheckpointTurnCount, orderedTurnDiffSummaries.length, selectedTurn],
  );
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled:
        diffQueriesEnabled && isGitRepo && !diffEnvironmentPending && diffViewKind === "turn",
    }),
  );
  const checkpointDisplay = resolveCheckpointDiffQueryDisplayState({
    isLoading: activeCheckpointDiffQuery.isLoading,
    isFetching: activeCheckpointDiffQuery.isFetching,
    data: activeCheckpointDiffQuery.data,
    error: activeCheckpointDiffQuery.error,
  });
  const selectedPatch = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : activeCheckpointDiffQuery.data?.diff;
  const repoDiffLiveRefreshIntervalMs = useMemo(
    () =>
      resolveDiffPanelRepoLiveRefetchIntervalMs({
        queriesEnabled: diffQueriesEnabled,
        liveRefreshEnabled,
        diffViewKind,
        shouldPollRepoDiff,
      }),
    [diffQueriesEnabled, diffViewKind, liveRefreshEnabled, shouldPollRepoDiff],
  );
  const repoDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: repoDiffScope,
      enabled: diffQueriesEnabled && !diffEnvironmentPending && diffViewKind === "repo",
      refetchInterval: repoDiffLiveRefreshIntervalMs,
    }),
  );
  const repoPatch = repoDiffQuery.data?.patch;
  const hasNoNetChanges = typeof selectedPatch === "string" && selectedPatch.trim().length === 0;
  const hasNoRepoChanges = typeof repoPatch === "string" && repoPatch.trim().length === 0;
  const repoDiffError =
    repoDiffQuery.error instanceof Error
      ? repoDiffQuery.error.message
      : repoDiffQuery.error
        ? "Failed to load repo diff."
        : null;
  const branchHasCommittedChanges = (gitStatusQuery.data?.aheadCount ?? 0) > 0;

  useEffect(() => {
    if (
      diffOpen &&
      diffViewKind === "repo" &&
      repoDiffScope === "workingTree" &&
      typeof repoPatch === "string" &&
      hasNoRepoChanges &&
      branchHasCommittedChanges
    ) {
      setRepoDiffScope("branch");
    }
  }, [
    branchHasCommittedChanges,
    diffOpen,
    diffViewKind,
    hasNoRepoChanges,
    repoDiffScope,
    repoPatch,
    setRepoDiffScope,
  ]);
  const viewSource = useMemo(
    () => resolveDiffPanelViewSource({ diffViewKind, repoDiffScope, selectedTurnId }),
    [diffViewKind, repoDiffScope, selectedTurnId],
  );
  const activeReviewPatch = diffViewKind === "repo" ? repoPatch : selectedPatch;
  const activeReviewError = diffViewKind === "repo" ? repoDiffError : checkpointDisplay.error;
  const activeReviewIsLoading =
    diffViewKind === "repo" ? repoDiffQuery.isLoading : checkpointDisplay.isLoading;
  const activeReviewHasNoChanges = diffViewKind === "repo" ? hasNoRepoChanges : hasNoNetChanges;
  const diffCopyText = useMemo(() => resolveDiffCopyText(activeReviewPatch), [activeReviewPatch]);
  const renderablePatch = useMemo(() => getRenderablePatch(activeReviewPatch), [activeReviewPatch]);
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") return [];
    return sortFileDiffsByPath(renderablePatch.files);
  }, [renderablePatch]);
  useEffect(() => {
    onRenderableFilesChange?.(renderableFiles, activeReviewIsLoading);
  }, [activeReviewIsLoading, onRenderableFilesChange, renderableFiles]);
  const activePatchStat = useMemo(
    () => summarizeRenderablePatchStats(renderablePatch),
    [renderablePatch],
  );
  const workingTreeDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: "workingTree",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const unstagedDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: "unstaged",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const stagedDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: "staged",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const branchDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: "branch",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const pickerScopeFileCounts = useMemo(() => {
    const counts: Partial<Record<RepoDiffScope, number>> = {};
    const patches: Array<[RepoDiffScope, string | undefined]> = [
      ["workingTree", workingTreeDiffQuery.data?.patch],
      ["unstaged", unstagedDiffQuery.data?.patch],
      ["staged", stagedDiffQuery.data?.patch],
      ["branch", branchDiffQuery.data?.patch],
    ];
    for (const [scope, patch] of patches) {
      const count = summarizePatchTotals(patch)?.fileCount;
      if (typeof count === "number") counts[scope] = count;
    }
    return counts;
  }, [
    branchDiffQuery.data?.patch,
    stagedDiffQuery.data?.patch,
    unstagedDiffQuery.data?.patch,
    workingTreeDiffQuery.data?.patch,
  ]);
  const scopeFileCounts = useMemo(
    () =>
      resolveDiffPanelScopeFileCounts({
        viewSource,
        activeScopeFileCount: activePatchStat?.fileCount,
        scopePickerOpen,
        pickerScopeCounts: pickerScopeFileCounts,
      }),
    [activePatchStat?.fileCount, pickerScopeFileCounts, scopePickerOpen, viewSource],
  );

  return {
    activeThreadId,
    activeThreadContext,
    activeCwd,
    diffQueriesEnabled,
    diffEnvironmentPending,
    gitRepoStatus,
    gitRepoStatusError,
    isGitRepo,
    repoDiffScope,
    setRepoDiffScope,
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    viewSource,
    renderablePatch,
    renderableFiles,
    activePatchStat,
    activeReviewIsLoading,
    activeReviewHasNoChanges,
    activeReviewError,
    diffCopyText,
    scopeFileCounts,
  };
}

export type DiffPanelReviewData = ReturnType<typeof useDiffPanelReviewData>;
