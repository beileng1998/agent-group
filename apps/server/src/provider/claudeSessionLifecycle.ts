import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent, ProviderRuntimeTurnStatus } from "@agent-group/contracts";
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Stream } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import {
  CLAUDE_BENIGN_TERMINATION_MESSAGE,
  hasPendingUserInterrupt,
  interruptionMessageFromClaudeCause,
  isClaudeBenignTerminationCause,
  isClaudeInterruptedCause,
  messageFromClaudeStreamCause,
  toError,
} from "./claudeAdapterErrors.ts";
import { asCanonicalTurnId, asRuntimeRequestId } from "./claudeAdapterProtocol.ts";
import { nativeProviderRefs } from "./claudeSdkMessage.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeSessionLifecycle(input: {
  readonly completeTurn: (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
  ) => Effect.Effect<void>;
  readonly emitRuntimeError: (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ) => Effect.Effect<void>;
  readonly handleSdkMessage: (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly removeSessionIfCurrent: (context: ClaudeSessionContext) => void;
  readonly settleSubagentRun: (
    context: ClaudeSessionContext,
    lookup: { readonly toolUseId?: string; readonly taskId?: string },
    status: "completed" | "failed" | "stopped",
    errorMessage?: string,
    options?: { readonly retainRun?: boolean },
  ) => Effect.Effect<void>;
}) {
  const stopSessionInternal = (
    context: ClaudeSessionContext,
    options?: { readonly emitExitEvent?: boolean },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (context.stopped) return;

      context.stopped = true;
      const turnWatchdogFiber = context.turnWatchdogFiber;
      context.turnWatchdogFiber = undefined;
      if (turnWatchdogFiber && turnWatchdogFiber.pollUnsafe() === undefined) {
        yield* Fiber.interrupt(turnWatchdogFiber);
      }
      for (const toolUseId of [...context.subagentRuns.keys()]) {
        yield* input.settleSubagentRun(context, { toolUseId }, "stopped");
      }

      for (const [requestId, pending] of context.pendingApprovals) {
        yield* Deferred.succeed(pending.decision, "cancel");
        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "request.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType: pending.requestType,
            decision: "cancel",
          },
          providerRefs: nativeProviderRefs(context),
        });
      }
      context.pendingApprovals.clear();

      if (context.turnState) {
        yield* input.completeTurn(context, "interrupted", "Session stopped.");
      }

      yield* Queue.shutdown(context.promptQueue);
      const streamFiber = context.streamFiber;
      context.streamFiber = undefined;
      if (streamFiber && streamFiber.pollUnsafe() === undefined) {
        yield* Fiber.interrupt(streamFiber);
      }

      try {
        context.query.close();
      } catch (cause) {
        yield* input.emitRuntimeError(context, "Failed to close Claude runtime query.", cause);
      }

      const updatedAt = yield* input.nowIso;
      context.session = {
        ...context.session,
        status: "closed",
        activeTurnId: undefined,
        updatedAt,
      };

      if (options?.emitExitEvent !== false) {
        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "session.exited",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          payload: { reason: "Session stopped", exitKind: "graceful" },
          providerRefs: {},
        });
      }
      input.removeSessionIfCurrent(context);
    });

  const handleStreamExit = (
    context: ClaudeSessionContext,
    exit: Exit.Exit<void, Error>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (context.stopped) {
        return;
      }

      if (Exit.isFailure(exit)) {
        if (hasPendingUserInterrupt(context) || isClaudeInterruptedCause(exit.cause)) {
          if (context.turnState) {
            yield* input.completeTurn(
              context,
              "interrupted",
              interruptionMessageFromClaudeCause(exit.cause),
            );
          }
        } else if (isClaudeBenignTerminationCause(exit.cause)) {
          yield* Effect.logInfo("claude.session.benign_termination", {
            threadId: context.session.threadId,
            detail: messageFromClaudeStreamCause(exit.cause, "Claude runtime terminated."),
          });
          if (context.turnState) {
            yield* input.completeTurn(context, "interrupted", CLAUDE_BENIGN_TERMINATION_MESSAGE);
          }
        } else {
          const message = messageFromClaudeStreamCause(exit.cause, "Claude runtime stream failed.");
          yield* input.emitRuntimeError(context, message, Cause.pretty(exit.cause));
          yield* input.completeTurn(context, "failed", message);
        }
      } else if (context.turnState) {
        yield* input.completeTurn(context, "interrupted", "Claude runtime stream ended.");
      }

      yield* stopSessionInternal(context, { emitExitEvent: true });
    });

  const runSdkStream = (context: ClaudeSessionContext): Effect.Effect<void, Error> =>
    Stream.fromAsyncIterable(context.query, (cause) =>
      toError(cause, "Claude runtime stream failed."),
    ).pipe(
      Stream.takeWhile(() => !context.stopped),
      Stream.runForEach((message) => input.handleSdkMessage(context, message)),
    );

  return { handleStreamExit, runSdkStream, stopSessionInternal };
}
