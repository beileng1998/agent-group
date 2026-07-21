import {
  addPinnedMessage,
  removePinnedMessage,
  setPinnedMessageDone,
  setPinnedMessageLabel,
} from "@agent-group/shared/pinnedMessages";
import { Effect, Option } from "effect";

import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import { ProjectionProjectRepository } from "../../../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadSessionRepository } from "../../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThreadRepository } from "../../../persistence/Services/ProjectionThreads.ts";
import { applyProjectMetadataProjection } from "../../projectMetadataProjection.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";
import { makeThreadHighlightProjection } from "./threadHighlightProjection.ts";

export const makeProjectThreadProjectors = Effect.gen(function* () {
  const projectionProjectRepository = yield* ProjectionProjectRepository;
  const projectionThreadRepository = yield* ProjectionThreadRepository;
  const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
  const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
  const highlights = yield* makeThreadHighlightProjection;

  const projects: ProjectorDefinition["apply"] = (event) =>
    event.type === "project.created" ||
    event.type === "project.meta-updated" ||
    event.type === "project.deleted"
      ? applyProjectMetadataProjection({ event, projectionProjectRepository }).pipe(Effect.asVoid)
      : Effect.void;

  const threads: ProjectorDefinition["apply"] = (event, attachmentSideEffects) =>
    Effect.gen(function* () {
      if (yield* highlights.applyMarkerEvent(event)) return;
      switch (event.type) {
        case "thread.created":
          yield* projectionThreadRepository.upsert({
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            modelSelection: event.payload.modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            envMode: event.payload.envMode ?? "local",
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            associatedWorktreePath: event.payload.associatedWorktreePath ?? null,
            associatedWorktreeBranch: event.payload.associatedWorktreeBranch ?? null,
            associatedWorktreeRef: event.payload.associatedWorktreeRef ?? null,
            createBranchFlowCompleted: event.payload.createBranchFlowCompleted ?? false,
            isPinned: event.payload.isPinned ?? false,
            parentThreadId: event.payload.parentThreadId ?? null,
            subagentAgentId: event.payload.subagentAgentId ?? null,
            subagentNickname: event.payload.subagentNickname ?? null,
            subagentRole: event.payload.subagentRole ?? null,
            forkSourceThreadId: event.payload.forkSourceThreadId,
            sidechatSourceThreadId: event.payload.sidechatSourceThreadId,
            lastKnownPr: event.payload.lastKnownPr ?? null,
            latestTurnId: null,
            handoff: event.payload.handoff,
            pinnedMessages: null,
            threadMarkers: null,
            notes: null,
            latestUserMessageAt: null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: 0,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
          });
          return;

        case "thread.meta-updated": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          const nextCreateBranchFlowCompleted =
            event.payload.createBranchFlowCompleted !== undefined
              ? event.payload.createBranchFlowCompleted
              : event.payload.branch !== undefined &&
                  event.payload.branch !== existingRow.value.branch
                ? false
                : undefined;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.modelSelection !== undefined
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            ...(event.payload.envMode !== undefined ? { envMode: event.payload.envMode } : {}),
            ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
            ...(event.payload.worktreePath !== undefined
              ? { worktreePath: event.payload.worktreePath }
              : {}),
            ...(event.payload.associatedWorktreePath !== undefined
              ? { associatedWorktreePath: event.payload.associatedWorktreePath }
              : {}),
            ...(event.payload.associatedWorktreeBranch !== undefined
              ? { associatedWorktreeBranch: event.payload.associatedWorktreeBranch }
              : {}),
            ...(event.payload.associatedWorktreeRef !== undefined
              ? { associatedWorktreeRef: event.payload.associatedWorktreeRef }
              : {}),
            ...(nextCreateBranchFlowCompleted !== undefined
              ? { createBranchFlowCompleted: nextCreateBranchFlowCompleted }
              : {}),
            ...(event.payload.isPinned !== undefined ? { isPinned: event.payload.isPinned } : {}),
            ...(event.payload.parentThreadId !== undefined
              ? { parentThreadId: event.payload.parentThreadId }
              : {}),
            ...(event.payload.forkSourceThreadId !== undefined
              ? { forkSourceThreadId: event.payload.forkSourceThreadId }
              : {}),
            ...(event.payload.subagentAgentId !== undefined
              ? { subagentAgentId: event.payload.subagentAgentId }
              : {}),
            ...(event.payload.subagentNickname !== undefined
              ? { subagentNickname: event.payload.subagentNickname }
              : {}),
            ...(event.payload.subagentRole !== undefined
              ? { subagentRole: event.payload.subagentRole }
              : {}),
            ...(event.payload.lastKnownPr !== undefined
              ? { lastKnownPr: event.payload.lastKnownPr }
              : {}),
            ...(event.payload.handoff !== undefined ? { handoff: event.payload.handoff } : {}),
            ...(event.payload.pinnedMessages !== undefined
              ? { pinnedMessages: event.payload.pinnedMessages }
              : {}),
            ...(event.payload.threadMarkers !== undefined
              ? { threadMarkers: event.payload.threadMarkers }
              : {}),
            ...(event.payload.notes !== undefined ? { notes: event.payload.notes } : {}),
            updatedAt: event.payload.updatedAt,
          });
          if (event.payload.threadMarkers !== undefined) {
            yield* highlights.replaceHighlightsForThread(
              event.payload.threadId,
              event.payload.threadMarkers,
            );
          }
          return;
        }

        case "thread.pinned-message-added":
        case "thread.pinned-message-removed":
        case "thread.pinned-message-done-set":
        case "thread.pinned-message-label-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          const pinnedMessages = (() => {
            switch (event.type) {
              case "thread.pinned-message-added":
                return addPinnedMessage(existingRow.value.pinnedMessages, event.payload.pin);
              case "thread.pinned-message-removed":
                return removePinnedMessage(
                  existingRow.value.pinnedMessages,
                  event.payload.messageId,
                );
              case "thread.pinned-message-done-set":
                return setPinnedMessageDone(
                  existingRow.value.pinnedMessages,
                  event.payload.messageId,
                  event.payload.done,
                );
              case "thread.pinned-message-label-set":
                return setPinnedMessageLabel(
                  existingRow.value.pinnedMessages,
                  event.payload.messageId,
                  event.payload.label,
                );
            }
          })();
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            pinnedMessages,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.runtime-mode-set":
        case "thread.interaction-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(event.type === "thread.runtime-mode-set"
              ? { runtimeMode: event.payload.runtimeMode }
              : { interactionMode: event.payload.interactionMode }),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.turn-start-requested": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          const [messages, session] = yield* Effect.all([
            projectionThreadMessageRepository.listByThreadId({
              threadId: event.payload.threadId,
            }),
            projectionThreadSessionRepository.getByThreadId({
              threadId: event.payload.threadId,
            }),
          ]);
          const canAdoptFirstTurnProvider =
            existingRow.value.latestTurnId === null &&
            Option.isNone(session) &&
            messages.length <= 1;
          const modelSelectionPatch =
            event.payload.modelSelection !== undefined &&
            (event.payload.modelSelection.provider === existingRow.value.modelSelection.provider ||
              canAdoptFirstTurnProvider)
              ? { modelSelection: event.payload.modelSelection }
              : {};
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...modelSelectionPatch,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.deleted": {
          attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        case "thread.archived":
        case "thread.unarchived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          if (event.type === "thread.archived") {
            const archivedAt =
              event.payload.archivedAt ?? event.payload.updatedAt ?? event.occurredAt;
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              archivedAt,
              updatedAt: event.payload.updatedAt ?? archivedAt,
            });
          } else {
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              archivedAt: null,
              updatedAt: event.payload.updatedAt ?? event.payload.unarchivedAt ?? event.occurredAt,
            });
          }
          return;
        }

        default:
          return;
      }
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.highlights:query")(cause)),
      ),
    );

  return { projects, threads };
});
