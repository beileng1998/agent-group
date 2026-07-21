import {
  type CommandId,
  EventId,
  type OrchestrationSession,
  type OrchestrationThread,
  type RuntimeMode,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";

export interface ProviderFailureActivityInput {
  readonly threadId: ThreadId;
  readonly kind:
    | "provider.turn.start.failed"
    | "provider.turn.interrupt.failed"
    | "provider.approval.respond.failed"
    | "provider.user-input.respond.failed"
    | "provider.session.stop.failed"
    | "agent-group.context.finalize.failed";
  readonly summary: string;
  readonly detail: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly requestId?: string;
}

const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

/** Owns provider-facing session and failure projections. */
export function makeProviderProjectionWriter<ResolveError>(dependencies: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly serverCommandId: (tag: string) => CommandId;
}) {
  const appendProviderFailureActivity = (input: ProviderFailureActivityInput) =>
    dependencies.orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: dependencies.serverCommandId("provider-failure-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: input.kind,
        summary: input.summary,
        payload: {
          detail: input.detail,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) =>
    dependencies.orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: dependencies.serverCommandId("provider-session-set"),
      threadId: input.threadId,
      session: input.session,
      createdAt: input.createdAt,
    });

  const setThreadSessionError = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly runtimeMode?: RuntimeMode;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    if (!thread) return;
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: "error",
        providerName: thread.session?.providerName ?? thread.modelSelection.provider,
        runtimeMode: input.runtimeMode ?? thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  return { appendProviderFailureActivity, setThreadSession, setThreadSessionError } as const;
}
