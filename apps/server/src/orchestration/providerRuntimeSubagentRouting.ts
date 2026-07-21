import {
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";
import {
  buildSubagentIdentityDirectory,
  collectSubagentProviderThreadIds,
  extractSubagentIdentityHints,
  resolveSubagentIdentityFromDirectory,
} from "@agent-group/shared/subagents";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { asObject } from "./providerRuntimeActivityValues.ts";
import {
  eventNeedsHeavyThreadDetail,
  normalizeIdentifier,
  providerCommandId,
  runtimePayloadRecord,
  threadDetailFromShell,
} from "./providerRuntimeIngestionValues.ts";

interface SubagentIdentity {
  readonly providerThreadId: string;
  readonly agentId?: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly model?: string;
  readonly modelIsRequestedHint?: boolean;
}

function subagentThreadId(parentThreadId: ThreadId, providerThreadId: string): ThreadId {
  return ThreadId.makeUnsafe(`subagent:${parentThreadId}:${providerThreadId}`);
}

function subagentThreadTitle(identity: {
  readonly nickname?: string;
  readonly role?: string;
  readonly providerThreadId?: string;
}): string {
  if (identity.nickname && identity.role) return `${identity.nickname} [${identity.role}]`;
  if (identity.nickname) return identity.nickname;
  if (identity.role) return `Subagent [${identity.role}]`;
  return identity.providerThreadId ? `Subagent ${identity.providerThreadId}` : "Subagent";
}

function extractCollabPayload(event: ProviderRuntimeEvent): Record<string, unknown> | undefined {
  return asObject(runtimePayloadRecord(event)?.data);
}

function extractSubagentIdentity(
  event: ProviderRuntimeEvent,
  providerThreadId: string,
): SubagentIdentity | undefined {
  const payload = extractCollabPayload(event);
  const item = asObject(payload?.item) ?? payload;
  if (!item) return undefined;
  return resolveSubagentIdentityFromDirectory(
    buildSubagentIdentityDirectory(extractSubagentIdentityHints(item)),
    { providerThreadId },
  ) as SubagentIdentity | undefined;
}

export function makeProviderRuntimeSubagentRouting(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
}) {
  const ensureSubagentThread = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly parentThread: OrchestrationThread;
    readonly providerThreadId: string;
    readonly identity?: Pick<
      SubagentIdentity,
      "agentId" | "nickname" | "role" | "model" | "modelIsRequestedHint"
    >;
  }) =>
    Effect.gen(function* () {
      const childThreadId = subagentThreadId(params.parentThread.id, params.providerThreadId);
      const existingThread = eventNeedsHeavyThreadDetail(params.event)
        ? yield* input.projectionSnapshotQuery.getThreadDetailById(childThreadId)
        : Option.map(
            yield* input.projectionSnapshotQuery.getThreadShellById(childThreadId),
            threadDetailFromShell,
          );
      const resolvedModelSelection =
        params.identity?.model && params.identity.modelIsRequestedHint !== true
          ? { provider: params.parentThread.modelSelection.provider, model: params.identity.model }
          : undefined;
      if (Option.isNone(existingThread)) {
        yield* input.orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: providerCommandId(params.event, "subagent-thread-create"),
          threadId: childThreadId,
          projectId: params.parentThread.projectId,
          title: subagentThreadTitle({
            ...(params.identity?.nickname !== undefined
              ? { nickname: params.identity.nickname }
              : {}),
            ...(params.identity?.role !== undefined ? { role: params.identity.role } : {}),
            providerThreadId: params.providerThreadId,
          }),
          modelSelection: resolvedModelSelection ?? params.parentThread.modelSelection,
          runtimeMode: params.parentThread.runtimeMode,
          interactionMode: params.parentThread.interactionMode,
          envMode: params.parentThread.envMode,
          branch: params.parentThread.branch,
          worktreePath: params.parentThread.worktreePath,
          associatedWorktreePath: params.parentThread.associatedWorktreePath,
          associatedWorktreeBranch: params.parentThread.associatedWorktreeBranch,
          associatedWorktreeRef: params.parentThread.associatedWorktreeRef,
          parentThreadId: params.parentThread.id,
          subagentAgentId: params.identity?.agentId ?? null,
          subagentNickname: params.identity?.nickname ?? null,
          subagentRole: params.identity?.role ?? null,
          createdAt: params.event.createdAt,
        });
      } else if (
        params.identity?.agentId !== undefined ||
        params.identity?.nickname !== undefined ||
        params.identity?.role !== undefined ||
        (params.identity?.model !== undefined && params.identity.modelIsRequestedHint !== true)
      ) {
        const existing = existingThread.value;
        const nickname = params.identity?.nickname ?? existing.subagentNickname ?? undefined;
        const role = params.identity?.role ?? existing.subagentRole ?? undefined;
        yield* input.orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: providerCommandId(params.event, "subagent-thread-meta-update"),
          threadId: childThreadId,
          ...(params.identity?.nickname !== undefined || params.identity?.role !== undefined
            ? {
                title: subagentThreadTitle({
                  ...(nickname !== undefined ? { nickname } : {}),
                  ...(role !== undefined ? { role } : {}),
                  providerThreadId: params.providerThreadId,
                }),
              }
            : {}),
          parentThreadId: params.parentThread.id,
          ...(resolvedModelSelection !== undefined &&
          existing.modelSelection.model !== resolvedModelSelection.model
            ? { modelSelection: resolvedModelSelection }
            : {}),
          ...(params.identity?.agentId !== undefined
            ? { subagentAgentId: params.identity.agentId }
            : {}),
          ...(params.identity?.nickname !== undefined
            ? { subagentNickname: params.identity.nickname }
            : {}),
          ...(params.identity?.role !== undefined ? { subagentRole: params.identity.role } : {}),
        });
      }
      return {
        threadId: childThreadId,
        thread: Option.match(existingThread, {
          onSome: (thread) => thread,
          onNone: () => ({
            ...params.parentThread,
            id: childThreadId,
            title: subagentThreadTitle({
              ...(params.identity?.nickname !== undefined
                ? { nickname: params.identity.nickname }
                : {}),
              ...(params.identity?.role !== undefined ? { role: params.identity.role } : {}),
              providerThreadId: params.providerThreadId,
            }),
            parentThreadId: params.parentThread.id,
            subagentAgentId: params.identity?.agentId ?? null,
            subagentNickname: params.identity?.nickname ?? null,
            subagentRole: params.identity?.role ?? null,
            modelSelection: resolvedModelSelection ?? params.parentThread.modelSelection,
            latestTurn: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
            createdAt: params.event.createdAt,
            updatedAt: params.event.createdAt,
          }),
        }),
      };
    });

  const resolveTargetThread = (event: ProviderRuntimeEvent, parentThread: OrchestrationThread) =>
    Effect.gen(function* () {
      const collabPayload = extractCollabPayload(event);
      const collabItem = asObject(collabPayload?.item) ?? collabPayload;
      const isCollabToolEvent =
        (event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed") &&
        event.payload.itemType === "collab_agent_tool_call" &&
        collabItem !== undefined;
      if (isCollabToolEvent && collabItem) {
        const directory = buildSubagentIdentityDirectory(extractSubagentIdentityHints(collabItem));
        for (const providerThreadId of collectSubagentProviderThreadIds(collabItem)) {
          const identity = resolveSubagentIdentityFromDirectory(directory, {
            providerThreadId,
          }) as SubagentIdentity | undefined;
          yield* ensureSubagentThread({
            event,
            parentThread,
            providerThreadId,
            ...(identity !== undefined ? { identity } : {}),
          });
        }
      }
      const providerThreadId = normalizeIdentifier(event.providerRefs?.providerThreadId);
      const parentProviderThreadId = normalizeIdentifier(
        event.providerRefs?.providerParentThreadId,
      );
      if (
        providerThreadId !== undefined &&
        parentProviderThreadId !== undefined &&
        providerThreadId !== parentProviderThreadId
      ) {
        const identity = extractSubagentIdentity(event, providerThreadId);
        return yield* ensureSubagentThread({
          event,
          parentThread,
          providerThreadId,
          ...(identity !== undefined ? { identity } : {}),
        });
      }
      return { threadId: parentThread.id, thread: parentThread };
    });

  return { resolveTargetThread };
}
