import type { PullRequestListEntry, PullRequestState } from "@agent-group/contracts";
import { coalescePullRequestListEntries } from "@agent-group/shared/githubRepository";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  focusPullRequestRow,
  isFocusInsideRightDock,
} from "~/components/pullRequest/pullRequestFocus";
import {
  filterPullRequestEntriesByInvolvement,
  groupPullRequestEntriesByInvolvement,
  matchesPullRequestSearchQuery,
  orderPullRequestEntriesPinnedFirst,
  pullRequestPinToggleInputs,
} from "~/components/pullRequest/pullRequestList.logic";
import { pullRequestPaneTabLabel } from "~/components/pullRequest/pullRequestDetail.logic";
import { usePullRequestPaneStateIcon } from "~/components/pullRequest/usePullRequestPaneStateIcon";
import { toastManager } from "~/components/ui/toast";
import {
  prefetchPullRequestListState,
  pullRequestMutationKeys,
  pullRequestQueryErrorState,
  pullRequestsExactInvolvementQueryOptions,
  pullRequestsForceRefreshMutationOptions,
  pullRequestsListQueryOptions,
  pullRequestSetPinnedMutationOptions,
  shouldLoadExactPullRequestInvolvement,
} from "~/lib/pullRequestReactQuery";
import {
  createDefaultRightDockState,
  openPaneInState,
  type RightDockThreadState,
} from "~/rightDockStore.logic";
import { useStore } from "~/store";

import {
  CLEARED_SELECTION,
  PULL_REQUESTS_ROUTE_PANE_ID,
  type PullRequestsSearch,
  type UpdatePullRequestsSearch,
} from "./pullRequestsIndexSearch";

export function usePullRequestsIndexController(
  search: PullRequestsSearch,
  updateSearch: UpdatePullRequestsSearch,
) {
  const projects = useStore((store) => store.projects);
  const queryClient = useQueryClient();
  // One fetch per (state, project): the server returns the "all" involvement superset and the
  // Reviewing/Authored tabs are derived below, so involvement switches never hit the network.
  const listInput = useMemo(
    () => ({ state: search.state, projectId: search.projectId ?? null }),
    [search.projectId, search.state],
  );
  const listQuery = useQuery(pullRequestsListQueryOptions(listInput));
  const refreshMutation = useMutation(pullRequestsForceRefreshMutationOptions(queryClient));
  const pinMutation = useMutation(pullRequestSetPinnedMutationOptions(queryClient));
  const activeActionCount = useIsMutating({ mutationKey: pullRequestMutationKeys.action });
  const repositoryProjects = useMemo(
    () =>
      projects
        .filter((project) => project.kind === "project")
        .map((project) => [project.id, project.name] as const)
        .toSorted((left, right) => left[1].localeCompare(right[1])),
    [projects],
  );
  const scopedProjectName = search.projectId
    ? repositoryProjects.find(([projectId]) => projectId === search.projectId)?.[1]
    : undefined;

  // Precise fallback for the filtered tabs: when a repository hit the per-repo entry cap, the
  // client-side involvement filter over the truncated superset can miss older matches, so the
  // active tab additionally fetches the server-filtered list.
  const supersetTruncated = (listQuery.data?.repositoryBatches ?? []).some(
    (batch) => batch.truncated,
  );
  const needsExactInvolvement = shouldLoadExactPullRequestInvolvement({
    involvement: search.involvement,
    state: search.state,
    supersetTruncated,
  });
  const exactInvolvementQuery = useQuery({
    ...pullRequestsExactInvolvementQueryOptions({
      involvement: search.involvement,
      state: search.state,
      projectId: search.projectId ?? null,
    }),
    enabled: needsExactInvolvement,
  });
  const exactInvolvementPending = needsExactInvolvement && exactInvolvementQuery.isPending;
  const listErrorState = pullRequestQueryErrorState(listQuery);
  const exactInvolvementErrorState = pullRequestQueryErrorState(
    exactInvolvementQuery,
    needsExactInvolvement,
  );
  const initialListError = listErrorState.initialError;
  const initialExactInvolvementError = exactInvolvementErrorState.initialError;
  const backgroundListError =
    listErrorState.backgroundError ?? exactInvolvementErrorState.backgroundError;
  const handleStateIntent = useCallback(
    (state: PullRequestState) => {
      if (state === search.state) return;
      void prefetchPullRequestListState(queryClient, {
        state,
        projectId: search.projectId ?? null,
      });
    },
    [queryClient, search.projectId, search.state],
  );
  const activeListData =
    needsExactInvolvement && exactInvolvementQuery.data
      ? exactInvolvementQuery.data
      : listQuery.data;

  // Multi-project result sets can be large. Keep typing responsive while React catches the
  // filtered rows up in a lower-priority render; virtualization can wait for measured need.
  const normalizedQuery = search.q?.trim().toLowerCase() ?? "";
  const query = useDeferredValue(normalizedQuery);
  const entries = useMemo(
    () =>
      orderPullRequestEntriesPinnedFirst(
        coalescePullRequestListEntries(
          filterPullRequestEntriesByInvolvement(
            activeListData?.entries ?? [],
            activeListData?.viewer ?? listQuery.data?.viewer,
            search.involvement,
          ).filter((entry) => matchesPullRequestSearchQuery(entry, query)),
          { preferredProjectId: search.selectedProjectId },
        ),
      ),
    [activeListData, listQuery.data?.viewer, query, search.involvement, search.selectedProjectId],
  );
  const grouped = useMemo(
    () =>
      search.involvement === "all"
        ? groupPullRequestEntriesByInvolvement(entries, listQuery.data?.viewer)
        : null,
    [entries, listQuery.data?.viewer, search.involvement],
  );

  // A crafted URL must not show Project A's list while opening Project B's PR.
  const selectionMatchesScope =
    search.projectId === undefined ||
    search.selectedProjectId === undefined ||
    search.selectedProjectId === search.projectId;
  const selectedInput =
    selectionMatchesScope && search.selectedProjectId && search.selectedRepo && search.number
      ? {
          projectId: search.selectedProjectId,
          repository: search.selectedRepo,
          number: search.number,
        }
      : null;
  const detailOpen = selectedInput !== null;
  const [renderedInput, setRenderedInput] = useState(selectedInput);
  useEffect(() => {
    if (selectedInput) setRenderedInput(selectedInput);
    // selectedInput is a fresh object literal every render; depend on its primitive fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.selectedProjectId, search.selectedRepo, search.number]);
  useEffect(() => {
    if (detailOpen) return;
    const timeout = window.setTimeout(() => setRenderedInput(null), 300);
    return () => window.clearTimeout(timeout);
  }, [detailOpen]);

  const closeDetail = useCallback(() => {
    const focusWasInsideDock = isFocusInsideRightDock(document.activeElement);
    const rowToRestore = selectedInput;
    updateSearch(CLEARED_SELECTION);
    if (focusWasInsideDock && rowToRestore) {
      requestAnimationFrame(() => {
        focusPullRequestRow(document, rowToRestore);
      });
    }
  }, [selectedInput, updateSearch]);

  const dockState = useMemo<RightDockThreadState>(() => {
    if (!renderedInput) return createDefaultRightDockState();
    const state = openPaneInState(createDefaultRightDockState(), {
      paneId: PULL_REQUESTS_ROUTE_PANE_ID,
      kind: "pullRequest",
      pullRequestProjectId: renderedInput.projectId,
      pullRequestRepository: renderedInput.repository,
      pullRequestNumber: renderedInput.number,
    });
    return detailOpen ? state : { ...state, open: false };
  }, [renderedInput, detailOpen]);
  const paneLabelOverrides = useMemo(
    () =>
      renderedInput
        ? { [PULL_REQUESTS_ROUTE_PANE_ID]: pullRequestPaneTabLabel(renderedInput.number) }
        : undefined,
    [renderedInput],
  );
  const paneStateIcon = usePullRequestPaneStateIcon(renderedInput);
  const paneIconOverrides = useMemo(
    () => (paneStateIcon ? { [PULL_REQUESTS_ROUTE_PANE_ID]: paneStateIcon } : undefined),
    [paneStateIcon],
  );
  const handleSelectPullRequest = useCallback(
    (entry: PullRequestListEntry) =>
      updateSearch({
        selectedProjectId: entry.projectId,
        selectedRepo: entry.repository,
        number: entry.number,
      }),
    [updateSearch],
  );
  const mutatePin = pinMutation.mutate;
  const handleTogglePinned = useCallback(
    (entry: PullRequestListEntry) => {
      for (const input of pullRequestPinToggleInputs(entry, search.projectId === undefined)) {
        mutatePin(input, {
          onError: (error) =>
            toastManager.add({
              type: "error",
              title: "Could not update pull request pin",
              description: error instanceof Error ? error.message : "The pin could not be saved.",
            }),
        });
      }
    },
    [mutatePin, search.projectId],
  );
  const refreshBlocked = refreshMutation.isPending || activeActionCount > 0;
  const mutateRefresh = refreshMutation.mutate;
  const handleManualRefresh = useCallback(() => {
    if (activeActionCount > 0) return;
    mutateRefresh(listInput, {
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not refresh pull requests",
          description:
            error instanceof Error
              ? error.message
              : "The pull request list could not be refreshed.",
        }),
    });
  }, [activeActionCount, listInput, mutateRefresh]);

  return {
    activeListData,
    backgroundListError,
    closeDetail,
    dockState,
    entries,
    exactInvolvementPending,
    exactInvolvementQuery,
    grouped,
    handleManualRefresh,
    handleSelectPullRequest,
    handleStateIntent,
    handleTogglePinned,
    initialExactInvolvementError,
    initialListError,
    listQuery,
    paneIconOverrides,
    paneLabelOverrides,
    refreshBlocked,
    refreshTitle: activeActionCount > 0 ? "Wait for the pull request action to finish" : "Refresh",
    refreshPending: refreshMutation.isPending,
    repositoryProjects,
    scopedProjectName,
    truncatedRepositoryCount:
      activeListData?.repositoryBatches.filter((batch) => batch.truncated).length ?? 0,
  };
}
