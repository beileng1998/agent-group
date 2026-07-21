// FILE: _chat.$threadId.tsx
// Purpose: Resolve the active thread route into either a single chat surface or a persisted split view.
// Layer: Route container

import { type ProjectId, ThreadId } from "@agent-group/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch } from "../diffRouteSearch";
import { useMissingThreadRouteRecovery } from "../hooks/useMissingThreadRouteRecovery";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { createThreadExistsSelector, createThreadProjectIdSelector } from "../storeSelectors";
import { resolveSingleProjectId } from "./-chatThreadRoute.logic";
import { SingleChatSurface } from "./-chatThreadRoute.singleSurface";
import { SplitChatSurface } from "./-chatThreadRoute.splitSurface";

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const hasKnownServerThreads = useStore(
    (store) => (store.threadIds?.length ?? 0) > 0 || store.threads.length > 0,
  );
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadProjectIdSelector = useMemo(
    () => createThreadProjectIdSelector(threadId),
    [threadId],
  );
  const threadExistsSelector = useMemo(() => createThreadExistsSelector(threadId), [threadId]);
  const threadProjectId: ProjectId | null = useStore(threadProjectIdSelector);
  const threadExists = useStore(threadExistsSelector);
  const draftThreadState = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const routeThreadExists = threadExists || draftThreadState !== null;
  const splitView = useSplitViewStore(selectSplitView(search.splitViewId ?? null));
  const splitViewsHydrated = useSplitViewStore((store) => store.hasHydrated);
  const activeProjectId = resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const recovery = useMissingThreadRouteRecovery({
    threadId,
    routeThreadExists,
    hasKnownServerThreads,
    threadsHydrated,
    splitViewsHydrated,
    search,
    splitView,
  });

  if (!recovery.routeReady) {
    return null;
  }

  if (splitView && search.splitViewId) {
    return <SplitChatSurface splitViewId={search.splitViewId} routeThreadId={threadId} />;
  }

  if (!routeThreadExists) {
    return null;
  }

  return <SingleChatSurface threadId={threadId} search={search} projectId={activeProjectId} />;
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});
