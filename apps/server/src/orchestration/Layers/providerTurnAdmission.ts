import {
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationThread,
  type RuntimeMode,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cause, Effect } from "effect";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { FirstTurnBranchInput, FirstTurnTitleInput } from "./providerFirstTurnMetadata.ts";
import type { ProviderTurnDispatchInput } from "./providerTurnPreparation.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";

type TurnStartRequestedEvent = Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>;
type TurnQueuedEvent = Extract<OrchestrationEvent, { type: "thread.turn-queued" }>;

type FailureActivityInput = {
  readonly threadId: ThreadId;
  readonly kind: "provider.turn.start.failed";
  readonly summary: string;
  readonly detail: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
};

const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

/** Owns live-turn admission, queue fallback, and first-turn dispatch. */
export function makeProviderTurnAdmission<
  ResolveError,
  HandledError,
  FailureError,
  SessionError,
  MetadataError,
  DispatchError,
  InterruptError,
  DrainError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly turnQueue: ProviderTurnQueue;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly hasHandledTurnStartRecently: (key: string) => Effect.Effect<boolean, HandledError>;
  readonly appendProviderFailureActivity: (
    input: FailureActivityInput,
  ) => Effect.Effect<unknown, FailureError>;
  readonly setThreadSession: (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, SessionError>;
  readonly setThreadSessionError: (input: {
    readonly threadId: ThreadId;
    readonly runtimeMode?: RuntimeMode;
    readonly detail: string;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, SessionError | ResolveError>;
  readonly maybeGenerateAndRenameWorktreeBranchForFirstTurn: (
    input: FirstTurnBranchInput,
  ) => Effect.Effect<unknown, MetadataError>;
  readonly maybeGenerateAndRenameThreadTitleForFirstTurn: (
    input: FirstTurnTitleInput,
  ) => Effect.Effect<unknown, MetadataError>;
  readonly dispatchTurnForThread: (
    input: ProviderTurnDispatchInput,
  ) => Effect.Effect<unknown, DispatchError>;
  readonly interruptProviderTurn: (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, InterruptError>;
  readonly drainQueuedTurnsForThread: (threadId: ThreadId) => Effect.Effect<unknown, DrainError>;
}) {
  const hasLiveProviderTurn = Effect.fnUntraced(function* (threadId: ThreadId) {
    const session = yield* dependencies.providerService
      .listSessions()
      .pipe(Effect.map((sessions) => sessions.find((entry) => entry.threadId === threadId)));
    return session?.status === "running" && session.activeTurnId !== undefined;
  });

  const processTurnStartRequested = Effect.fnUntraced(function* (event: TurnStartRequestedEvent) {
    dependencies.turnQueue.clearDispatchPending(event.payload.threadId);
    const key = event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;
    if (yield* dependencies.hasHandledTurnStartRecently(key)) return;
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    if (!thread) return;
    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* dependencies.appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const providerName = thread.session?.providerName ?? thread.modelSelection.provider;
    const desiredProvider =
      event.payload.modelSelection?.provider ?? thread.modelSelection.provider;
    const hasLiveTurn = yield* hasLiveProviderTurn(event.payload.threadId);
    const canSteerLiveCodex =
      event.payload.dispatchMode === "steer" &&
      providerName === "codex" &&
      desiredProvider === providerName &&
      hasLiveTurn;
    if (!canSteerLiveCodex && hasLiveTurn) {
      dependencies.turnQueue.enqueue(event.payload);
      if (event.payload.dispatchMode === "steer") {
        yield* dependencies.interruptProviderTurn({
          threadId: event.payload.threadId,
          createdAt: event.payload.createdAt,
        });
      }
      return;
    }

    if (!canSteerLiveCodex) {
      yield* dependencies.setThreadSession({
        threadId: event.payload.threadId,
        session: {
          threadId: event.payload.threadId,
          status: "starting",
          providerName: desiredProvider,
          runtimeMode:
            thread.session?.runtimeMode ?? event.payload.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          activeTurnId: null,
          lastError: null,
          updatedAt: event.payload.createdAt,
        },
        createdAt: event.payload.createdAt,
      });
    }

    yield* dependencies
      .maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.providerOptions !== undefined
          ? { providerOptions: event.payload.providerOptions }
          : {}),
      })
      .pipe(Effect.forkScoped);
    yield* dependencies
      .maybeGenerateAndRenameThreadTitleForFirstTurn({
        threadId: event.payload.threadId,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.providerOptions !== undefined
          ? { providerOptions: event.payload.providerOptions }
          : {}),
      })
      .pipe(Effect.forkScoped);
    const editResendKey = dependencies.turnQueue.editResendKey(
      event.payload.threadId,
      event.payload.messageId,
    );
    yield* dependencies
      .dispatchTurnForThread({
        threadId: event.payload.threadId,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(message.skills !== undefined ? { skills: message.skills } : {}),
        ...(message.mentions !== undefined ? { mentions: message.mentions } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.providerOptions !== undefined
          ? { providerOptions: event.payload.providerOptions }
          : {}),
        ...(event.payload.runtimeMode !== undefined
          ? { runtimeMode: event.payload.runtimeMode }
          : {}),
        ...(event.payload.reviewTarget !== undefined
          ? { reviewTarget: event.payload.reviewTarget }
          : {}),
        interactionMode: event.payload.interactionMode,
        dispatchMode: canSteerLiveCodex ? "steer" : "queue",
        createdAt: event.payload.createdAt,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const detail = Cause.pretty(cause);
            yield* dependencies.appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              detail,
              turnId: null,
              createdAt: event.payload.createdAt,
            });
            yield* dependencies.setThreadSessionError({
              threadId: event.payload.threadId,
              runtimeMode: event.payload.runtimeMode,
              detail,
              createdAt: event.payload.createdAt,
            });
            yield* dependencies.drainQueuedTurnsForThread(event.payload.threadId);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => dependencies.turnQueue.completeEditResend(editResendKey)),
        ),
      );
  });

  const processTurnQueued = Effect.fnUntraced(function* (event: TurnQueuedEvent) {
    dependencies.turnQueue.enqueue(event.payload);
    if (!(yield* hasLiveProviderTurn(event.payload.threadId))) {
      yield* dependencies.drainQueuedTurnsForThread(event.payload.threadId);
    }
  });

  return { hasLiveProviderTurn, processTurnQueued, processTurnStartRequested } as const;
}
