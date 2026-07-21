import type {
  MessageMentionReference,
  OrchestrationProjectShell,
  OrchestrationThread,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { isSessionMentionReference } from "@agent-group/shared/messageMentions";
import { Cause, Effect, Option } from "effect";

import {
  finalizeAgentGroupTurn,
  type AgentGroupMentionedSession,
} from "../../agentGroup/runtime.ts";
import { isAgentGroupSession } from "../../agentGroup/session.ts";
import type { AgentGroupCoordinates } from "../../agentGroup/state.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import type { ProviderQueueDrainEvent } from "./providerTurnBootstrapState.ts";

const MAX_MENTIONED_SESSIONS = 12;

/** Owns Agent Group coordinates, mentioned-session resolution, and context finalization. */
export function makeProviderAgentGroupBridge<
  ResolveError,
  ProjectError,
  FailureError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveThreadWorkspaceProject: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<OrchestrationProjectShell | undefined, ProjectError>;
  readonly appendFinalizeFailure: (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, FailureError>;
}) {
  const resolveAgentGroupCoordinates = Effect.fnUntraced(function* (
    thread: OrchestrationThread,
  ): Effect.fn.Return<AgentGroupCoordinates | null, ProjectError> {
    if (!isAgentGroupSession(thread)) return null;
    const project = yield* dependencies.resolveThreadWorkspaceProject(thread);
    if (!project || project.kind !== "project") return null;
    return {
      workspaceRoot: project.workspaceRoot,
      groupId: thread.projectId,
      sessionId: thread.id,
      ...(thread.parentThreadId !== undefined ? { parentSessionId: thread.parentThreadId } : {}),
      createdAt: thread.createdAt,
    };
  });

  const finalizeAgentGroupContextTurn = Effect.fnUntraced(function* (
    event: ProviderQueueDrainEvent,
    turnId: TurnId | null,
  ) {
    yield* Effect.gen(function* () {
      const thread = yield* dependencies.resolveThread(event.threadId);
      if (!thread) return;
      const coordinates = yield* resolveAgentGroupCoordinates(thread);
      if (!coordinates) return;
      yield* Effect.tryPromise(() =>
        finalizeAgentGroupTurn({
          ...coordinates,
          turnId,
          successful: event.type === "turn.completed" && event.payload.state === "completed",
        }),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("agent group failed to finalize session context", {
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        }).pipe(
          Effect.andThen(
            dependencies
              .appendFinalizeFailure({
                threadId: event.threadId,
                detail: Cause.pretty(cause),
                turnId,
                createdAt: event.createdAt,
              })
              .pipe(Effect.catchCause(() => Effect.void)),
          ),
        ),
      ),
    );
  });

  const resolveMentionedAgentGroupSessions = Effect.fnUntraced(function* (
    thread: OrchestrationThread,
    mentions: ReadonlyArray<MessageMentionReference>,
  ) {
    const resolved: AgentGroupMentionedSession[] = [];
    const seen = new Set<string>();
    for (const mention of mentions) {
      if (!isSessionMentionReference(mention) || resolved.length >= MAX_MENTIONED_SESSIONS)
        continue;
      if (mention.sessionId === thread.id || seen.has(mention.sessionId)) continue;
      seen.add(mention.sessionId);
      const target = Option.getOrUndefined(
        yield* dependencies.projectionSnapshotQuery.getThreadShellById(mention.sessionId),
      );
      if (
        !target ||
        target.projectId !== thread.projectId ||
        target.archivedAt ||
        !isAgentGroupSession(target)
      ) {
        continue;
      }
      const transcriptPath = dependencies.providerService.resolveTranscriptPath
        ? yield* dependencies.providerService.resolveTranscriptPath({ threadId: target.id }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to resolve mentioned session transcript path", {
                threadId: target.id,
                error,
              }).pipe(Effect.as(null)),
            ),
          )
        : null;
      resolved.push({
        sessionId: target.id,
        title: target.title,
        ...(target.parentThreadId !== undefined ? { parentSessionId: target.parentThreadId } : {}),
        createdAt: target.createdAt,
        ...(transcriptPath ? { transcriptPath } : {}),
      });
    }
    return resolved;
  });

  return {
    finalizeAgentGroupContextTurn,
    resolveAgentGroupCoordinates,
    resolveMentionedAgentGroupSessions,
  } as const;
}
