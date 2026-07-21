import {
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationThread,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { buildStalePendingRequestFailureDetail } from "@agent-group/shared/threadSummary";
import { Cause, Effect, Schema } from "effect";

import { ProviderAdapterRequestError, type ProviderServiceError } from "../../provider/Errors.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";

type InteractionEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested";
  }
>;

type FailureActivityInput = {
  readonly threadId: ThreadId;
  readonly kind:
    | "provider.turn.interrupt.failed"
    | "provider.approval.respond.failed"
    | "provider.user-input.respond.failed";
  readonly summary: string;
  readonly detail: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly requestId?: string;
};

const DEFAULT_RUNTIME_MODE = "full-access" as const;

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

/** Owns provider interrupt, interaction responses, and explicit session stop. */
export function makeProviderInteractionHandlers<
  ResolveError,
  ProviderThreadError,
  FailureError,
  SessionError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly bootstrapState: ProviderTurnBootstrapState;
  readonly turnQueue: ProviderTurnQueue;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveProviderSessionThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | null, ProviderThreadError>;
  readonly resolveSubagentProviderThreadId: (
    threadId: ThreadId,
    parentThreadId: ThreadId | null | undefined,
  ) => string | undefined;
  readonly appendProviderFailureActivity: (
    input: FailureActivityInput,
  ) => Effect.Effect<unknown, FailureError>;
  readonly setThreadSession: (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, SessionError>;
}) {
  const interruptProviderTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
  }) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    const providerThread = yield* dependencies.resolveProviderSessionThread(input.threadId);
    if (!thread || !providerThread) return;
    if (!providerThread.session || providerThread.session.status === "stopped") {
      return yield* dependencies.appendProviderFailureActivity({
        threadId: input.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: input.turnId ?? null,
        createdAt: input.createdAt,
      });
    }
    const providerThreadId = dependencies.resolveSubagentProviderThreadId(
      thread.id,
      providerThread.id,
    );
    const turnId = input.turnId ?? thread.session?.activeTurnId ?? undefined;
    yield* dependencies.providerService.interruptTurn({
      threadId: providerThread.id,
      ...(turnId ? { turnId } : {}),
      ...(providerThreadId ? { providerThreadId } : {}),
    });
  });

  const processTurnInterruptRequested = (
    event: Extract<InteractionEvent, { type: "thread.turn-interrupt-requested" }>,
  ) =>
    interruptProviderTurn({
      threadId: event.payload.threadId,
      ...(event.payload.turnId !== undefined ? { turnId: event.payload.turnId } : {}),
      createdAt: event.payload.createdAt,
    });

  const processApprovalResponseRequested = Effect.fnUntraced(function* (
    event: Extract<InteractionEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    if (!thread) return;
    const providerThread = yield* dependencies.resolveProviderSessionThread(event.payload.threadId);
    if (providerThread?.session?.status === "stopped") {
      return yield* dependencies.appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }
    yield* dependencies.providerService
      .respondToRequest({
        threadId: providerThread?.id ?? event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          dependencies.appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            detail: isUnknownPendingApprovalRequestError(cause)
              ? buildStalePendingRequestFailureDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fnUntraced(function* (
    event: Extract<InteractionEvent, { type: "thread.user-input-response-requested" }>,
  ) {
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    if (!thread) return;
    const providerThread = yield* dependencies.resolveProviderSessionThread(event.payload.threadId);
    if (providerThread?.session?.status === "stopped") {
      return yield* dependencies.appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }
    yield* dependencies.providerService
      .respondToUserInput({
        threadId: providerThread?.id ?? event.payload.threadId,
        requestId: event.payload.requestId,
        answers: event.payload.answers,
      })
      .pipe(
        Effect.catchCause((cause) =>
          dependencies.appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.user-input.respond.failed",
            summary: "Provider user input response failed",
            detail: isUnknownPendingUserInputRequestError(cause)
              ? buildStalePendingRequestFailureDetail("user-input", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processSessionStopRequested = Effect.fnUntraced(function* (
    event: Extract<InteractionEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    const providerThread = yield* dependencies.resolveProviderSessionThread(event.payload.threadId);
    if (!thread) return;
    dependencies.turnQueue.clearThread(thread.id);
    dependencies.bootstrapState.clearContext(thread.id);
    dependencies.bootstrapState.suppressNextStart(thread.id);
    const now = event.payload.createdAt;
    const providerThreadId = providerThread
      ? dependencies.resolveSubagentProviderThreadId(thread.id, providerThread.id)
      : undefined;
    const isChildProviderRuntime =
      providerThread !== null && providerThread.id !== thread.id && providerThreadId !== undefined;
    if (
      isChildProviderRuntime &&
      thread.session?.status === "running" &&
      thread.session.activeTurnId !== null &&
      providerThread.session?.status !== "stopped"
    ) {
      yield* dependencies.providerService.interruptTurn({
        threadId: providerThread.id,
        turnId: thread.session.activeTurnId,
        providerThreadId,
      });
      yield* dependencies.setThreadSession({
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "interrupted",
          providerName: thread.session.providerName ?? null,
          runtimeMode: thread.session.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          activeTurnId: thread.session.activeTurnId,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });
      return;
    }
    const ownsProviderSession = providerThread !== null && providerThread.id === thread.id;
    if (thread.session && thread.session.status !== "stopped" && ownsProviderSession) {
      yield* dependencies.providerService.stopSession({ threadId: providerThread.id });
    }
    yield* dependencies.setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  return {
    interruptProviderTurn,
    processApprovalResponseRequested,
    processSessionStopRequested,
    processTurnInterruptRequested,
    processUserInputResponseRequested,
  } as const;
}
