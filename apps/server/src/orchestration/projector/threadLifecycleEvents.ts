import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { OrchestrationThread } from "@agent-group/contracts";
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
import { Effect } from "effect";

import {
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMarkerAddedPayload,
  ThreadMarkerColorSetPayload,
  ThreadMarkerDoneSetPayload,
  ThreadMarkerLabelSetPayload,
  ThreadMarkerNoteSetPayload,
  ThreadMarkerRemovedPayload,
  ThreadMetaUpdatedPayload,
  ThreadPinnedMessageAddedPayload,
  ThreadPinnedMessageDoneSetPayload,
  ThreadPinnedMessageLabelSetPayload,
  ThreadPinnedMessageRemovedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
} from "../Schemas.ts";
import { decodeForEvent, type ProjectorEffect, updateThread } from "./common.ts";

export type ThreadLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.created"
      | "thread.deleted"
      | "thread.archived"
      | "thread.unarchived"
      | "thread.meta-updated"
      | "thread.pinned-message-added"
      | "thread.pinned-message-removed"
      | "thread.pinned-message-done-set"
      | "thread.pinned-message-label-set"
      | "thread.marker-added"
      | "thread.marker-removed"
      | "thread.marker-done-set"
      | "thread.marker-label-set"
      | "thread.marker-color-set"
      | "thread.marker-note-set"
      | "thread.runtime-mode-set"
      | "thread.interaction-mode-set";
  }
>;

export function projectThreadLifecycleEvent(
  nextBase: OrchestrationReadModel,
  event: ThreadLifecycleEvent,
): ProjectorEffect {
  switch (event.type) {
    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            envMode: payload.envMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            associatedWorktreePath: payload.associatedWorktreePath,
            associatedWorktreeBranch: payload.associatedWorktreeBranch,
            associatedWorktreeRef: payload.associatedWorktreeRef,
            createBranchFlowCompleted: payload.createBranchFlowCompleted,
            isPinned: payload.isPinned,
            parentThreadId: payload.parentThreadId,
            subagentAgentId: payload.subagentAgentId,
            subagentNickname: payload.subagentNickname,
            subagentRole: payload.subagentRole,
            forkSourceThreadId: payload.forkSourceThreadId,
            sidechatSourceThreadId: payload.sidechatSourceThreadId,
            lastKnownPr: payload.lastKnownPr ?? null,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            handoff: payload.handoff,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const archivedAt = payload.archivedAt ?? payload.updatedAt ?? event.occurredAt;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              archivedAt,
              updatedAt: payload.updatedAt ?? archivedAt,
            }),
          };
        }),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const updatedAt = payload.updatedAt ?? payload.unarchivedAt ?? event.occurredAt;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              archivedAt: null,
              updatedAt,
            }),
          };
        }),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          const nextCreateBranchFlowCompleted =
            payload.createBranchFlowCompleted !== undefined
              ? payload.createBranchFlowCompleted
              : payload.branch !== undefined &&
                  existingThread !== null &&
                  payload.branch !== existingThread.branch
                ? false
                : undefined;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              ...(payload.title !== undefined ? { title: payload.title } : {}),
              ...(payload.modelSelection !== undefined
                ? { modelSelection: payload.modelSelection }
                : {}),
              ...(payload.envMode !== undefined ? { envMode: payload.envMode } : {}),
              ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
              ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
              ...(payload.associatedWorktreePath !== undefined
                ? { associatedWorktreePath: payload.associatedWorktreePath }
                : {}),
              ...(payload.associatedWorktreeBranch !== undefined
                ? { associatedWorktreeBranch: payload.associatedWorktreeBranch }
                : {}),
              ...(payload.associatedWorktreeRef !== undefined
                ? { associatedWorktreeRef: payload.associatedWorktreeRef }
                : {}),
              ...(nextCreateBranchFlowCompleted !== undefined
                ? { createBranchFlowCompleted: nextCreateBranchFlowCompleted }
                : {}),
              ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
              ...(payload.parentThreadId !== undefined
                ? { parentThreadId: payload.parentThreadId }
                : {}),
              ...(payload.forkSourceThreadId !== undefined
                ? { forkSourceThreadId: payload.forkSourceThreadId }
                : {}),
              ...(payload.subagentAgentId !== undefined
                ? { subagentAgentId: payload.subagentAgentId }
                : {}),
              ...(payload.subagentNickname !== undefined
                ? { subagentNickname: payload.subagentNickname }
                : {}),
              ...(payload.subagentRole !== undefined ? { subagentRole: payload.subagentRole } : {}),
              ...(payload.lastKnownPr !== undefined ? { lastKnownPr: payload.lastKnownPr } : {}),
              ...(payload.handoff !== undefined ? { handoff: payload.handoff } : {}),
              ...(payload.pinnedMessages !== undefined
                ? { pinnedMessages: payload.pinnedMessages }
                : {}),
              ...(payload.threadMarkers !== undefined
                ? { threadMarkers: payload.threadMarkers }
                : {}),
              ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.pinned-message-added":
      return decodeForEvent(
        ThreadPinnedMessageAddedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              pinnedMessages: addPinnedMessage(existingThread?.pinnedMessages, payload.pin),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.pinned-message-removed":
      return decodeForEvent(
        ThreadPinnedMessageRemovedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              pinnedMessages: removePinnedMessage(
                existingThread?.pinnedMessages,
                payload.messageId,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.pinned-message-done-set":
      return decodeForEvent(
        ThreadPinnedMessageDoneSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              pinnedMessages: setPinnedMessageDone(
                existingThread?.pinnedMessages,
                payload.messageId,
                payload.done,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.pinned-message-label-set":
      return decodeForEvent(
        ThreadPinnedMessageLabelSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              pinnedMessages: setPinnedMessageLabel(
                existingThread?.pinnedMessages,
                payload.messageId,
                payload.label,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-added":
      return decodeForEvent(ThreadMarkerAddedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: addThreadMarker(existingThread?.threadMarkers, payload.marker),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-removed":
      return decodeForEvent(ThreadMarkerRemovedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: removeThreadMarker(existingThread?.threadMarkers, payload.markerId),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-done-set":
      return decodeForEvent(ThreadMarkerDoneSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: setThreadMarkerDone(
                existingThread?.threadMarkers,
                payload.markerId,
                payload.done,
                payload.updatedAt,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-label-set":
      return decodeForEvent(ThreadMarkerLabelSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: setThreadMarkerLabel(
                existingThread?.threadMarkers,
                payload.markerId,
                payload.label,
                payload.updatedAt,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-color-set":
      return decodeForEvent(ThreadMarkerColorSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: setThreadMarkerColor(
                existingThread?.threadMarkers,
                payload.markerId,
                payload.color,
                payload.updatedAt,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.marker-note-set":
      return decodeForEvent(ThreadMarkerNoteSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingThread =
            nextBase.threads.find((thread) => thread.id === payload.threadId) ?? null;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              threadMarkers: setThreadMarkerNote(
                existingThread?.threadMarkers,
                payload.markerId,
                payload.note,
                payload.updatedAt,
              ),
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );
  }
}
