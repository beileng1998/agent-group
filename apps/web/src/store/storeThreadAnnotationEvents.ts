// FILE: storeThreadAnnotationEvents.ts
// Purpose: Reduce pinned-message, marker, and message projection events.
// Layer: Web state event reducers

import type { OrchestrationEvent } from "@agent-group/contracts";
import {
  addPinnedMessage,
  removePinnedMessage,
  setPinnedMessageDone,
  setPinnedMessageLabel,
} from "@agent-group/shared/pinnedMessages";
import {
  addThreadMarker,
  removeThreadMarker,
  setThreadMarkerColor,
  setThreadMarkerDone,
  setThreadMarkerLabel,
  setThreadMarkerNote,
} from "@agent-group/shared/threadMarkers";
import type { Thread } from "../types";
import { applyThreadMessageSentEvent } from "./storeMessageMutation";
import type { AppState, ApplyOrchestrationEventOptions } from "./storeState";
import {
  threadMessageUpdatesSidebarSummary,
  threadMessageUpdatesSummary,
} from "./storeSidebarProjection";
import { resolveEventUpdatedAt } from "./storeThreadSlices";
import { applyThreadUpdate } from "./storeTurnMutation";

export function reduceThreadAnnotationEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState | undefined {
  switch (event.type) {
    case "thread.pinned-message-added":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = addPinnedMessage(thread.pinnedMessages, event.payload.pin);
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-removed":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = removePinnedMessage(
            thread.pinnedMessages,
            event.payload.messageId,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-done-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = setPinnedMessageDone(
            thread.pinnedMessages,
            event.payload.messageId,
            event.payload.done,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-label-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = setPinnedMessageLabel(
            thread.pinnedMessages,
            event.payload.messageId,
            event.payload.label,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.marker-added":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = addThreadMarker(thread.threadMarkers, event.payload.marker);
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.marker-removed":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = removeThreadMarker(thread.threadMarkers, event.payload.markerId);
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.marker-done-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = setThreadMarkerDone(
            thread.threadMarkers,
            event.payload.markerId,
            event.payload.done,
            event.payload.updatedAt,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.marker-label-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = setThreadMarkerLabel(
            thread.threadMarkers,
            event.payload.markerId,
            event.payload.label,
            event.payload.updatedAt,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.marker-color-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = setThreadMarkerColor(
            thread.threadMarkers,
            event.payload.markerId,
            event.payload.color,
            event.payload.updatedAt,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.message-sent":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => applyThreadMessageSentEvent(thread, event),
        {
          ...options,
          recomputeSummarySignals: threadMessageUpdatesSummary(event),
          updateSidebarSummary:
            options?.updateSidebarSummary === true || threadMessageUpdatesSidebarSummary(event),
        },
      );

    case "thread.marker-note-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const threadMarkers = setThreadMarkerNote(
            thread.threadMarkers,
            event.payload.markerId,
            event.payload.note,
            event.payload.updatedAt,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.threadMarkers === threadMarkers && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            threadMarkers,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );
    default:
      return undefined;
  }
}
