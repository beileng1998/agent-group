import { ThreadId } from "@agent-group/contracts";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { readNativeApi } from "../nativeApi";
import { resolveSplitViewThreadIds, selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import {
  resolveThreadDetailSubscriptionIds,
  useRetainedThreadDetailIds,
} from "../threadDetailSubscriptionRetention";
import { useTerminalStateStore } from "../terminalStateStore";
import { useWorkspaceStore } from "../workspaceStore";
import { createRootEventDomainBatch } from "./-rootEventDomainBatch";
import { createRootEventOrchestrationRuntime } from "./-rootEventOrchestrationStream";
import { subscribeRootEventPeripheralStreams } from "./-rootEventPeripheralStreams";
import {
  SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS,
  THREAD_DETAIL_CATCHUP_INTERVAL_MS,
} from "./-rootEventRouterValues";

export function EventRouter() {
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const syncServerThreadDetailHotPath = useStore((store) => store.syncServerThreadDetailHotPath);
  const applyShellEvent = useStore((store) => store.applyShellEvent);
  const applyOrchestrationEventsHotPath = useStore(
    (store) => store.applyOrchestrationEventsHotPath,
  );
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const workspacePages = useWorkspaceStore((store) => store.workspacePages);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeSearch = useDiffRouteSearch();
  const activeSplitView = useSplitViewStore(selectSplitView(routeSearch.splitViewId ?? null));
  const visibleThreadIds = useMemo(() => {
    if (activeSplitView) return resolveSplitViewThreadIds(activeSplitView);
    return routeThreadId ? [routeThreadId] : [];
  }, [activeSplitView, routeThreadId]);
  const retainedThreadIds = useRetainedThreadDetailIds();
  const subscribedThreadIds = useMemo(
    () => resolveThreadDetailSubscriptionIds({ visibleThreadIds, retainedThreadIds }),
    [retainedThreadIds, visibleThreadIds],
  );
  const workspacePagesRef = useRef(workspacePages);
  const pathnameRef = useRef(pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const routeVisibleThreadIdsRef = useRef(visibleThreadIds);
  const subscribedThreadIdsRef = useRef(subscribedThreadIds);
  const reconcileThreadSubscriptionsRef = useRef<
    ((threadIds: readonly ThreadId[]) => Promise<void>) | null
  >(null);

  workspacePagesRef.current = workspacePages;
  pathnameRef.current = pathname;
  routeVisibleThreadIdsRef.current = visibleThreadIds;
  subscribedThreadIdsRef.current = subscribedThreadIds;

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    const domainBatch = createRootEventDomainBatch({
      queryClient,
      applyEvents: applyOrchestrationEventsHotPath,
    });
    const orchestration = createRootEventOrchestrationRuntime({
      api,
      isDisposed: () => disposed,
      getInitialSubscribedThreadIds: () => subscribedThreadIdsRef.current,
      getRouteVisibleThreadIds: () => routeVisibleThreadIdsRef.current,
      getWorkspacePages: () => workspacePagesRef.current,
      queueDomainEvent: domainBatch.queue,
      syncShellSnapshot: syncServerShellSnapshot,
      syncThreadDetail: syncServerThreadDetailHotPath,
      applyShellEvent,
      removeOrphanedTerminalStates,
    });
    reconcileThreadSubscriptionsRef.current = orchestration.reconcileThreadSubscriptions;

    const unsubscribeRetainedThreadIdChanges = orchestration.subscribeRetainedChanges();
    const unsubShellEvent = orchestration.subscribeShellEvents();
    const unsubThreadEvent = orchestration.subscribeThreadEvents();
    const unsubscribePeripheralStreams = subscribeRootEventPeripheralStreams({
      api,
      queryClient,
      isDisposed: () => disposed,
      ensureScopedSubscriptions: orchestration.ensureScopedSubscriptions,
      loadShellSnapshotOnce: orchestration.loadShellSnapshotOnce,
      getPathname: () => pathnameRef.current,
      hasHandledBootstrapThread: (threadId) => handledBootstrapThreadIdRef.current === threadId,
      markBootstrapThreadHandled: (threadId) => {
        handledBootstrapThreadIdRef.current = threadId;
      },
      navigateToThread: (threadId) =>
        navigate({
          to: "/$threadId",
          params: { threadId },
          replace: true,
        }),
    });

    void orchestration.ensureScopedSubscriptions();
    const shellBootstrapFallbackTimer = window.setTimeout(() => {
      void orchestration.loadShellSnapshotOnce().catch(() => undefined);
    }, SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS);
    const threadDetailCatchupInterval = window.setInterval(() => {
      orchestration.pollThreadCatchup();
    }, THREAD_DETAIL_CATCHUP_INTERVAL_MS);

    return () => {
      domainBatch.flush();
      disposed = true;
      window.clearTimeout(shellBootstrapFallbackTimer);
      window.clearInterval(threadDetailCatchupInterval);
      domainBatch.dispose();
      reconcileThreadSubscriptionsRef.current = null;
      orchestration.unsubscribeServerScopes();
      unsubscribeRetainedThreadIdChanges();
      unsubShellEvent();
      unsubThreadEvent();
      unsubscribePeripheralStreams();
    };
  }, [
    applyOrchestrationEventsHotPath,
    applyShellEvent,
    navigate,
    queryClient,
    removeOrphanedTerminalStates,
    syncServerShellSnapshot,
    syncServerThreadDetailHotPath,
  ]);

  useLayoutEffect(() => {
    const reconcile = reconcileThreadSubscriptionsRef.current;
    if (reconcile) void reconcile(subscribedThreadIds);
  }, [subscribedThreadIds]);

  return null;
}
