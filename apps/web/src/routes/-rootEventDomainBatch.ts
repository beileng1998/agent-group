import { type OrchestrationEvent, type ThreadId } from "@agent-group/contracts";
import { type QueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";

import { invalidateGitQueries, invalidateGitQueriesForCwds } from "../lib/gitReactQuery";
import { invalidateProjectFileQueriesForCwds, projectQueryKeys } from "../lib/projectReactQuery";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { serverQueryKeys } from "../lib/serverReactQuery";
import { useStore } from "../store";
import {
  getGitInvalidationThreadIdForEvent,
  getProjectFileInvalidationThreadIdForEvent,
  getStudioOutputInvalidationThreadIdForEvent,
  resolveGitInvalidationCwdForThreadId,
  shouldInvalidateGitQueriesForEvent,
  shouldInvalidateProviderQueriesForEvent,
} from "./-rootEventInvalidation";
import {
  coalesceOrchestrationUiEvents,
  shouldFlushDomainEventImmediately,
} from "./-rootEventRouterValues";

export interface RootEventDomainBatch {
  readonly queue: (event: OrchestrationEvent) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

export function createRootEventDomainBatch(input: {
  readonly queryClient: QueryClient;
  readonly applyEvents: (events: ReadonlyArray<OrchestrationEvent>) => void;
}): RootEventDomainBatch {
  let needsProviderInvalidation = false;
  let needsBroadGitInvalidation = false;
  let pendingGitInvalidationThreadIds = new Set<ThreadId>();
  let pendingProjectFileInvalidationThreadIds = new Set<ThreadId>();
  let pendingStudioOutputInvalidationThreadIds = new Set<ThreadId>();
  let pendingDomainEvents: OrchestrationEvent[] = [];
  const immediatelyFlushedAssistantMessageIds = new Set<string>();

  const flush = () => {
    if (pendingDomainEvents.length > 0) {
      input.applyEvents(coalesceOrchestrationUiEvents(pendingDomainEvents));
      pendingDomainEvents = [];
    }
    if (needsProviderInvalidation) {
      needsProviderInvalidation = false;
      pendingProjectFileInvalidationThreadIds = new Set();
      void input.queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      void input.queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    } else if (pendingProjectFileInvalidationThreadIds.size > 0) {
      const currentState = useStore.getState();
      const fileChangeCwds = new Set<string>();
      for (const threadId of pendingProjectFileInvalidationThreadIds) {
        const cwd = resolveGitInvalidationCwdForThreadId(currentState, threadId);
        if (cwd) fileChangeCwds.add(cwd);
      }
      pendingProjectFileInvalidationThreadIds = new Set();
      if (fileChangeCwds.size > 0) {
        void invalidateProjectFileQueriesForCwds(input.queryClient, fileChangeCwds);
      } else {
        void input.queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
      }
    }
    if (pendingStudioOutputInvalidationThreadIds.size > 0) {
      for (const threadId of pendingStudioOutputInvalidationThreadIds) {
        void input.queryClient.invalidateQueries({
          queryKey: serverQueryKeys.studioThreadOutputs(threadId),
        });
      }
      pendingStudioOutputInvalidationThreadIds = new Set();
    }
    if (needsBroadGitInvalidation) {
      needsBroadGitInvalidation = false;
      pendingGitInvalidationThreadIds = new Set();
      void invalidateGitQueries(input.queryClient);
    } else if (pendingGitInvalidationThreadIds.size > 0) {
      const currentState = useStore.getState();
      const scopedCwds = new Set<string>();
      let hasUnresolvedThread = false;
      for (const threadId of pendingGitInvalidationThreadIds) {
        const cwd = resolveGitInvalidationCwdForThreadId(currentState, threadId);
        if (cwd) scopedCwds.add(cwd);
        else hasUnresolvedThread = true;
      }
      pendingGitInvalidationThreadIds = new Set();
      if (hasUnresolvedThread || scopedCwds.size === 0) {
        void invalidateGitQueries(input.queryClient);
      } else {
        void invalidateGitQueriesForCwds(input.queryClient, scopedCwds);
      }
    }
  };

  const throttler = new Throttler(flush, {
    wait: 100,
    leading: false,
    trailing: true,
  });

  const queue = (event: OrchestrationEvent) => {
    pendingDomainEvents.push(event);
    if (shouldInvalidateProviderQueriesForEvent(event)) needsProviderInvalidation = true;
    const projectFileThreadId = getProjectFileInvalidationThreadIdForEvent(event);
    if (projectFileThreadId) pendingProjectFileInvalidationThreadIds.add(projectFileThreadId);
    const studioOutputThreadId = getStudioOutputInvalidationThreadIdForEvent(event);
    if (studioOutputThreadId) pendingStudioOutputInvalidationThreadIds.add(studioOutputThreadId);
    if (shouldInvalidateGitQueriesForEvent(event)) {
      const threadId = getGitInvalidationThreadIdForEvent(event);
      if (threadId) pendingGitInvalidationThreadIds.add(threadId);
      else needsBroadGitInvalidation = true;
    }
    if (shouldFlushDomainEventImmediately(event, immediatelyFlushedAssistantMessageIds)) {
      throttler.cancel();
      flush();
      return;
    }
    throttler.maybeExecute();
  };

  return {
    queue,
    flush,
    dispose: () => {
      needsProviderInvalidation = false;
      needsBroadGitInvalidation = false;
      pendingGitInvalidationThreadIds = new Set();
      pendingProjectFileInvalidationThreadIds = new Set();
      pendingStudioOutputInvalidationThreadIds = new Set();
      throttler.cancel();
    },
  };
}
