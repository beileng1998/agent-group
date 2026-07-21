import {
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type ThreadId,
} from "@agent-group/contracts";

import { finalizePromotedDraftThreads, markPromotedDraftThreads } from "../composerDraftStore";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";

export const SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS = 1_500;
export const THREAD_DETAIL_CATCHUP_INTERVAL_MS = 1_500;
export const PENDING_SHELL_EVENT_BUFFER_LIMIT = 1_024;
export const PENDING_THREAD_EVENT_BUFFER_LIMIT = 512;
const IMMEDIATE_ASSISTANT_FLUSH_ID_LIMIT = 512;

function shellThreadHasStarted(thread: OrchestrationShellSnapshot["threads"][number]): boolean {
  return thread.latestTurn !== null || thread.session !== null;
}

export function reconcilePromotedDraftsFromShellThreads(
  threads: ReadonlyArray<OrchestrationShellSnapshot["threads"][number]>,
): void {
  markPromotedDraftThreads(new Set(threads.map((thread) => thread.id)));
  finalizePromotedDraftThreads(
    new Set(threads.filter((thread) => shellThreadHasStarted(thread)).map((thread) => thread.id)),
  );
}

export function reconcilePromotedDraftFromThreadDetail(thread: OrchestrationThread): void {
  markPromotedDraftThreads(new Set([thread.id]));
  if (shellThreadHasStarted(thread) || thread.messages.length > 0) {
    finalizePromotedDraftThreads(new Set([thread.id]));
  }
}

export function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) return [...events];

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments: event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }
    coalesced.push(event);
  }
  return coalesced;
}

export function appendBounded<T>(items: T[], item: T, limit: number): void {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (items.length >= normalizedLimit) {
    items.splice(0, items.length - normalizedLimit + 1);
  }
  items.push(item);
}

function addBoundedSetValue<T>(set: Set<T>, value: T, limit: number): void {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (set.has(value)) set.delete(value);
  while (set.size >= normalizedLimit) {
    const oldestValue = set.values().next().value as T | undefined;
    if (oldestValue === undefined) break;
    set.delete(oldestValue);
  }
  set.add(value);
}

export function shouldFlushDomainEventImmediately(
  event: OrchestrationEvent,
  immediatelyFlushedAssistantMessageIds: Set<string>,
): boolean {
  if (event.type !== "thread.message-sent" || event.payload.role !== "assistant") return false;
  if (!event.payload.streaming) {
    immediatelyFlushedAssistantMessageIds.delete(event.payload.messageId);
    return false;
  }
  if (immediatelyFlushedAssistantMessageIds.has(event.payload.messageId)) return false;
  addBoundedSetValue(
    immediatelyFlushedAssistantMessageIds,
    event.payload.messageId,
    IMMEDIATE_ASSISTANT_FLUSH_ID_LIMIT,
  );
  return true;
}

export function isThreadDetailEventForThread(
  event: OrchestrationEvent,
  threadId: ThreadId,
): boolean {
  if (event.aggregateKind !== "thread" || event.aggregateId !== threadId) return false;
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.conversation-rolled-back" ||
    event.type === "thread.session-set" ||
    event.type === "thread.meta-updated" ||
    event.type === "thread.pinned-message-added" ||
    event.type === "thread.pinned-message-removed" ||
    event.type === "thread.pinned-message-done-set" ||
    event.type === "thread.pinned-message-label-set" ||
    event.type === "thread.marker-added" ||
    event.type === "thread.marker-removed" ||
    event.type === "thread.marker-done-set" ||
    event.type === "thread.marker-label-set" ||
    event.type === "thread.marker-color-set" ||
    event.type === "thread.marker-note-set" ||
    event.type === "thread.archived" ||
    event.type === "thread.unarchived"
  );
}

export function shouldPollThreadDetailCatchup(threadId: ThreadId): boolean {
  const thread = getThreadFromState(useStore.getState(), threadId);
  return (
    thread?.session?.orchestrationStatus === "running" || thread?.latestTurn?.state === "running"
  );
}
