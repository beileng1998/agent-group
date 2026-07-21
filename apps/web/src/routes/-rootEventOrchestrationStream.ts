import {
  ThreadId,
  type NativeApi,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  type OrchestrationThread,
} from "@agent-group/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { dockTerminalThreadId } from "../lib/dockTerminalScope";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import { useStore } from "../store";
import { subscribeRetainedThreadDetailIdChanges } from "../threadDetailSubscriptionRetention";
import { workspaceThreadId } from "../workspaceStore";
import {
  appendBounded,
  isThreadDetailEventForThread,
  PENDING_SHELL_EVENT_BUFFER_LIMIT,
  PENDING_THREAD_EVENT_BUFFER_LIMIT,
  reconcilePromotedDraftFromThreadDetail,
  reconcilePromotedDraftsFromShellThreads,
  shouldPollThreadDetailCatchup,
} from "./-rootEventRouterValues";

export interface RootEventOrchestrationRuntime {
  readonly subscribedThreadIds: Set<ThreadId>;
  readonly reconcileThreadSubscriptions: (threadIds: readonly ThreadId[]) => Promise<void>;
  readonly subscribeRetainedChanges: () => () => void;
  readonly subscribeShellEvents: () => () => void;
  readonly subscribeThreadEvents: () => () => void;
  readonly ensureScopedSubscriptions: () => Promise<void>;
  readonly loadShellSnapshotOnce: () => Promise<void>;
  readonly pollThreadCatchup: () => void;
  readonly unsubscribeServerScopes: () => void;
}

export function createRootEventOrchestrationRuntime(input: {
  readonly api: NativeApi;
  readonly isDisposed: () => boolean;
  readonly getInitialSubscribedThreadIds: () => readonly ThreadId[];
  readonly getRouteVisibleThreadIds: () => readonly ThreadId[];
  readonly getWorkspacePages: () => ReadonlyArray<{ readonly id: string }>;
  readonly queueDomainEvent: (event: OrchestrationEvent) => void;
  readonly syncShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  readonly syncThreadDetail: (thread: OrchestrationThread) => void;
  readonly applyShellEvent: (event: OrchestrationShellStreamEvent) => void;
  readonly removeOrphanedTerminalStates: (activeThreadIds: Set<ThreadId>) => void;
}): RootEventOrchestrationRuntime {
  let shellSnapshotSequence = -1;
  let pendingShellEvents: OrchestrationShellStreamEvent[] = [];
  const subscribedThreadIds = new Set<ThreadId>();
  const threadSnapshotSequenceById = new Map<ThreadId, number>();
  const pendingThreadEventsById = new Map<ThreadId, OrchestrationEvent[]>();
  const threadSnapshotRequestInFlight = new Set<ThreadId>();
  const threadReplayRequestInFlight = new Set<ThreadId>();
  let reconcileThreadSubscriptionsChain = Promise.resolve();

  const removeOrphanedTerminalsForCurrentState = () => {
    const draftThreadIds = Object.keys(
      useComposerDraftStore.getState().draftThreadsByThreadId,
    ) as ThreadId[];
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: useStore.getState().threads.map((thread) => ({
        id: thread.id,
        deletedAt: null,
        archivedAt: thread.archivedAt ?? null,
      })),
      draftThreadIds,
      retainedThreadIds: input
        .getWorkspacePages()
        .map((workspace) => workspaceThreadId(workspace.id)),
    });
    for (const activeThreadId of Array.from(activeThreadIds)) {
      activeThreadIds.add(dockTerminalThreadId(activeThreadId));
    }
    input.removeOrphanedTerminalStates(activeThreadIds);
  };

  const beginThreadSubscription = (threadId: ThreadId) => {
    threadSnapshotSequenceById.delete(threadId);
    pendingThreadEventsById.set(threadId, []);
    threadSnapshotRequestInFlight.delete(threadId);
  };

  const requestThreadSnapshot = async (threadId: ThreadId) => {
    if (threadSnapshotSequenceById.has(threadId) || threadSnapshotRequestInFlight.has(threadId)) {
      return;
    }
    threadSnapshotRequestInFlight.add(threadId);
    try {
      await input.api.orchestration.subscribeThread({ threadId });
    } catch {
      // A draft route may not exist server-side yet. Preserve its buffer for retry.
    } finally {
      threadSnapshotRequestInFlight.delete(threadId);
    }
  };

  const flushThreadBuffer = (threadId: ThreadId, snapshotSequence: number) => {
    const pendingEvents = pendingThreadEventsById.get(threadId) ?? [];
    pendingThreadEventsById.delete(threadId);
    let latestThreadSequence = threadSnapshotSequenceById.get(threadId) ?? snapshotSequence;
    for (const event of pendingEvents.toSorted((left, right) => left.sequence - right.sequence)) {
      if (event.sequence > latestThreadSequence) {
        latestThreadSequence = event.sequence;
        threadSnapshotSequenceById.set(threadId, latestThreadSequence);
        input.queueDomainEvent(event);
      }
    }
  };

  const flushShellBuffer = (snapshotSequence: number) => {
    const nextPending = pendingShellEvents
      .filter((event) => event.sequence > snapshotSequence)
      .toSorted((left, right) => left.sequence - right.sequence);
    pendingShellEvents = [];
    for (const event of nextPending) {
      shellSnapshotSequence = Math.max(shellSnapshotSequence, event.sequence);
      input.applyShellEvent(event);
    }
  };

  const reconcileSubscriptions = async (threadIds: readonly ThreadId[]) => {
    const nextThreadIds = new Set(threadIds);
    const removals = [...subscribedThreadIds].filter((threadId) => !nextThreadIds.has(threadId));
    const additions = [...nextThreadIds].filter((threadId) => !subscribedThreadIds.has(threadId));
    for (const threadId of additions) {
      beginThreadSubscription(threadId);
      subscribedThreadIds.add(threadId);
    }
    await Promise.all(
      additions.map((threadId) =>
        input.api.orchestration.subscribeThread({ threadId }).catch(() => undefined),
      ),
    );
    for (const threadId of removals) {
      threadSnapshotSequenceById.delete(threadId);
      pendingThreadEventsById.delete(threadId);
      threadSnapshotRequestInFlight.delete(threadId);
      threadReplayRequestInFlight.delete(threadId);
      subscribedThreadIds.delete(threadId);
    }
    await Promise.all(
      removals.map((threadId) =>
        input.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined),
      ),
    );
  };

  const reconcileThreadSubscriptions = (threadIds: readonly ThreadId[]) => {
    const nextThreadIds = [...threadIds];
    reconcileThreadSubscriptionsChain = reconcileThreadSubscriptionsChain
      .catch(() => undefined)
      .then(() => reconcileSubscriptions(nextThreadIds));
    return reconcileThreadSubscriptionsChain;
  };

  const shouldApplyBootstrapShellSnapshot = (snapshot: OrchestrationShellSnapshot) => {
    if (input.isDisposed()) return false;
    const currentState = useStore.getState();
    if (!currentState.threadsHydrated) return true;
    return (
      (currentState.projects.length === 0 && snapshot.projects.length > 0) ||
      (currentState.threads.length === 0 && snapshot.threads.length > 0)
    );
  };

  const loadShellSnapshotOnce = async () => {
    const snapshot = await input.api.orchestration.getShellSnapshot();
    if (!shouldApplyBootstrapShellSnapshot(snapshot)) return;
    shellSnapshotSequence = snapshot.snapshotSequence;
    input.syncShellSnapshot(snapshot);
    reconcilePromotedDraftsFromShellThreads(snapshot.threads);
    removeOrphanedTerminalsForCurrentState();
    flushShellBuffer(snapshot.snapshotSequence);
  };

  const ensureScopedSubscriptions = async () => {
    shellSnapshotSequence = -1;
    pendingShellEvents = [];
    subscribedThreadIds.clear();
    threadSnapshotSequenceById.clear();
    pendingThreadEventsById.clear();
    threadReplayRequestInFlight.clear();
    await input.api.orchestration.subscribeShell().catch(() => loadShellSnapshotOnce());
    await reconcileThreadSubscriptions(input.getInitialSubscribedThreadIds());
  };

  const replayThreadEvents = async (threadId: ThreadId, targetSequence?: number) => {
    if (input.isDisposed() || threadReplayRequestInFlight.has(threadId)) return;
    const fromSequence = threadSnapshotSequenceById.get(threadId);
    if (
      fromSequence === undefined ||
      (targetSequence !== undefined && fromSequence >= targetSequence)
    ) {
      return;
    }
    threadReplayRequestInFlight.add(threadId);
    try {
      const replayedEvents = await input.api.orchestration.replayEvents(fromSequence);
      for (const event of replayedEvents
        .filter((candidate) => isThreadDetailEventForThread(candidate, threadId))
        .filter((candidate) => targetSequence === undefined || candidate.sequence <= targetSequence)
        .toSorted((left, right) => left.sequence - right.sequence)) {
        const latestThreadSequence = threadSnapshotSequenceById.get(threadId) ?? fromSequence;
        if (event.sequence <= latestThreadSequence) continue;
        threadSnapshotSequenceById.set(threadId, event.sequence);
        input.queueDomainEvent(event);
      }
    } finally {
      threadReplayRequestInFlight.delete(threadId);
    }
  };

  return {
    subscribedThreadIds,
    reconcileThreadSubscriptions,
    subscribeRetainedChanges: () =>
      subscribeRetainedThreadDetailIdChanges((nextRetainedThreadIds) => {
        const nextThreadIds = new Set(input.getRouteVisibleThreadIds());
        for (const threadId of nextRetainedThreadIds) nextThreadIds.add(threadId);
        void reconcileThreadSubscriptions([...nextThreadIds]);
      }),
    subscribeShellEvents: () =>
      input.api.orchestration.onShellEvent((item) => {
        if (item.kind === "snapshot") {
          shellSnapshotSequence = item.snapshot.snapshotSequence;
          input.syncShellSnapshot(item.snapshot);
          reconcilePromotedDraftsFromShellThreads(item.snapshot.threads);
          removeOrphanedTerminalsForCurrentState();
          flushShellBuffer(item.snapshot.snapshotSequence);
          return;
        }
        if (shellSnapshotSequence < 0) {
          appendBounded(pendingShellEvents, item, PENDING_SHELL_EVENT_BUFFER_LIMIT);
          return;
        }
        if (item.sequence <= shellSnapshotSequence) return;
        shellSnapshotSequence = item.sequence;
        input.applyShellEvent(item);
        if (item.kind === "thread-upserted") {
          reconcilePromotedDraftsFromShellThreads([item.thread]);
          if (subscribedThreadIds.has(item.thread.id)) {
            if (!threadSnapshotSequenceById.has(item.thread.id)) {
              void requestThreadSnapshot(item.thread.id);
            }
            void replayThreadEvents(item.thread.id, item.sequence).catch(() => undefined);
          }
        }
      }),
    subscribeThreadEvents: () =>
      input.api.orchestration.onThreadEvent((item) => {
        if (item.kind === "snapshot") {
          const threadId = item.snapshot.thread.id;
          threadSnapshotSequenceById.set(threadId, item.snapshot.snapshotSequence);
          threadSnapshotRequestInFlight.delete(threadId);
          input.syncThreadDetail(item.snapshot.thread);
          reconcilePromotedDraftFromThreadDetail(item.snapshot.thread);
          flushThreadBuffer(threadId, item.snapshot.snapshotSequence);
          return;
        }
        const threadId = ThreadId.makeUnsafe(String(item.event.aggregateId));
        const latestThreadSequence = threadSnapshotSequenceById.get(threadId);
        if (latestThreadSequence === undefined) {
          const pendingThreadEvents = pendingThreadEventsById.get(threadId) ?? [];
          appendBounded(pendingThreadEvents, item.event, PENDING_THREAD_EVENT_BUFFER_LIMIT);
          pendingThreadEventsById.set(threadId, pendingThreadEvents);
          if (subscribedThreadIds.has(threadId)) void requestThreadSnapshot(threadId);
          return;
        }
        if (item.event.sequence <= latestThreadSequence) return;
        threadSnapshotSequenceById.set(threadId, item.event.sequence);
        input.queueDomainEvent(item.event);
      }),
    ensureScopedSubscriptions,
    loadShellSnapshotOnce,
    pollThreadCatchup: () => {
      for (const threadId of subscribedThreadIds) {
        if (!shouldPollThreadDetailCatchup(threadId)) continue;
        if (!threadSnapshotSequenceById.has(threadId)) void requestThreadSnapshot(threadId);
        else void replayThreadEvents(threadId).catch(() => undefined);
      }
    },
    unsubscribeServerScopes: () => {
      void input.api.orchestration.unsubscribeShell().catch(() => undefined);
      void Promise.all(
        [...subscribedThreadIds].map((threadId) =>
          input.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined),
        ),
      );
    },
  };
}
