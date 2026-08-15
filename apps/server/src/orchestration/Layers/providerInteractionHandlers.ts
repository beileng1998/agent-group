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
import { runBoundedProviderControl } from "../../provider/boundedProviderControl.ts";
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
    | "provider.user-input.respond.failed"
    | "provider.session.stop.failed";
  readonly summary: string;
  readonly detail: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly requestId?: string;
};

const DEFAULT_RUNTIME_MODE = "full-access" as const;
const PROVIDER_INTERRUPT_TIMEOUT_MS = 10_000;
const PROVIDER_STOP_TIMEOUT_MS = 15_000;

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
  TerminalStopError,
  ReleaseError,
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
  readonly stopCurrentAdapter: (
    threadId: ThreadId,
    stopStructured: () => Effect.Effect<void, unknown>,
  ) => Effect.Effect<"structured" | "terminal", TerminalStopError>;
  readonly releaseCanceledClaims: () => Effect.Effect<unknown, ReleaseError>;
  readonly providerInterruptTimeoutMs?: number;
  readonly providerStopTimeoutMs?: number;
}) {
  const providerInterruptTimeoutMs =
    dependencies.providerInterruptTimeoutMs ?? PROVIDER_INTERRUPT_TIMEOUT_MS;
  const providerStopTimeoutMs = dependencies.providerStopTimeoutMs ?? PROVIDER_STOP_TIMEOUT_MS;
  const recordFailure = (input: FailureActivityInput) =>
    dependencies.appendProviderFailureActivity(input).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to project provider control failure", {
          threadId: input.threadId,
          kind: input.kind,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  const settleThreadLocally = (
    thread: OrchestrationThread,
    createdAt: string,
    detail: string,
    status: "interrupted" | "stopped" = "interrupted",
  ) => {
    const hasActiveTurn =
      thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.session?.activeTurnId != null ||
      thread.latestTurn?.state === "running";
    if (!hasActiveTurn) return Effect.void;
    return dependencies.setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status,
        providerName: thread.session?.providerName ?? thread.modelSelection.provider,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: detail.slice(0, 2_000),
        updatedAt: createdAt,
      },
      createdAt,
    });
  };
  const stopProviderSession = (threadId: ThreadId) =>
    runBoundedProviderControl({
      label: "The provider session stop",
      timeoutMs: providerStopTimeoutMs,
      effect: dependencies.providerService.stopSession({ threadId }),
    });

  const interruptProviderTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
  }) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    const providerThread = yield* dependencies.resolveProviderSessionThread(input.threadId);
    if (!thread) return;
    if (!providerThread?.session || providerThread.session.status === "stopped") {
      const detail = "No active provider session is bound to this thread.";
      yield* recordFailure({
        threadId: input.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail,
        turnId: input.turnId ?? null,
        createdAt: input.createdAt,
      });
      return yield* settleThreadLocally(thread, input.createdAt, detail);
    }
    const providerThreadId = dependencies.resolveSubagentProviderThreadId(
      thread.id,
      providerThread.id,
    );
    const turnId = input.turnId ?? thread.session?.activeTurnId ?? undefined;
    const interrupted = yield* runBoundedProviderControl({
      label: "The provider interrupt",
      timeoutMs: providerInterruptTimeoutMs,
      effect: dependencies.providerService.interruptTurn({
        threadId: providerThread.id,
        ...(turnId ? { turnId } : {}),
        ...(providerThreadId ? { providerThreadId } : {}),
      }),
    });
    if (interrupted._tag === "completed") return;

    yield* recordFailure({
      threadId: input.threadId,
      kind: "provider.turn.interrupt.failed",
      summary: "Provider turn interrupt failed",
      detail: interrupted.detail,
      turnId: input.turnId ?? null,
      createdAt: input.createdAt,
    });
    if (providerThread.id === thread.id) {
      const stopped = yield* stopProviderSession(providerThread.id);
      if (stopped._tag !== "completed") {
        yield* recordFailure({
          threadId: input.threadId,
          kind: "provider.session.stop.failed",
          summary: "Provider session stop failed",
          detail: stopped.detail,
          turnId: null,
          createdAt: input.createdAt,
        });
      }
    }
    yield* settleThreadLocally(thread, input.createdAt, interrupted.detail);
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
    if (!thread) return;
    dependencies.turnQueue.clearThread(thread.id);
    yield* dependencies.releaseCanceledClaims();
    dependencies.bootstrapState.clearContext(thread.id);
    dependencies.bootstrapState.suppressNextStart(thread.id);
    const now = event.payload.createdAt;
    const setStoppedSession = dependencies.setThreadSession({
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
    let structuredProjection = setStoppedSession;
    const owner = yield* dependencies.stopCurrentAdapter(thread.id, () =>
      Effect.gen(function* () {
        // Ownership can change while this event waits for the coordinator.
        // Resolve the provider binding only after structured authority is
        // atomically confirmed.
        const providerThread = yield* dependencies.resolveProviderSessionThread(
          event.payload.threadId,
        );
        const providerThreadId = providerThread
          ? dependencies.resolveSubagentProviderThreadId(thread.id, providerThread.id)
          : undefined;
        const isChildProviderRuntime =
          providerThread !== null &&
          providerThread.id !== thread.id &&
          providerThreadId !== undefined;
        if (
          isChildProviderRuntime &&
          thread.session?.status === "running" &&
          thread.session.activeTurnId !== null &&
          providerThread.session?.status !== "stopped"
        ) {
          const interrupted = yield* runBoundedProviderControl({
            label: "The provider interrupt",
            timeoutMs: providerInterruptTimeoutMs,
            effect: dependencies.providerService.interruptTurn({
              threadId: providerThread.id,
              turnId: thread.session.activeTurnId,
              providerThreadId,
            }),
          });
          if (interrupted._tag !== "completed") {
            yield* recordFailure({
              threadId: thread.id,
              kind: "provider.turn.interrupt.failed",
              summary: "Provider turn interrupt failed",
              detail: interrupted.detail,
              turnId: thread.session.activeTurnId,
              createdAt: now,
            });
            structuredProjection = settleThreadLocally(
              thread,
              now,
              interrupted.detail,
              "stopped",
            );
            return;
          }
          structuredProjection = dependencies.setThreadSession({
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
          const stopped = yield* stopProviderSession(providerThread.id);
          if (stopped._tag !== "completed") {
            yield* recordFailure({
              threadId: thread.id,
              kind: "provider.session.stop.failed",
              summary: "Provider session stop failed",
              detail: stopped.detail,
              turnId: null,
              createdAt: now,
            });
          }
        }
      }),
    );
    yield* owner === "terminal" ? setStoppedSession : structuredProjection;
  });

  return {
    interruptProviderTurn,
    processApprovalResponseRequested,
    processSessionStopRequested,
    processTurnInterruptRequested,
    processUserInputResponseRequested,
  } as const;
}
