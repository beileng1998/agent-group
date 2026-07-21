import {
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderStartReviewInput,
  ProviderSteerTurnInput,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProviderServiceShape } from "../../Services/ProviderService.ts";
import { decodeInputOrValidationError, toValidationError } from "./providerServiceInput.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  ResolveRoutableSession,
  WithBindingWriteLock,
} from "./providerServiceTypes.ts";

export function makeProviderTurnOperations(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly resolveRoutableSession: ResolveRoutableSession;
  readonly withBindingWriteLock: WithBindingWriteLock;
}) {
  const { directory, bindingCoordinator } = input.dependencies;

  const sendTurn: ProviderServiceShape["sendTurn"] = (rawInput) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.sendTurn",
        schema: ProviderSendTurnInput,
        payload: rawInput,
      });
      const request = { ...parsed, attachments: parsed.attachments ?? [] };
      if (!request.input && request.attachments.length === 0) {
        return yield* toValidationError(
          "ProviderService.sendTurn",
          "Either input text or at least one attachment is required",
        );
      }
      return yield* input.idle.runSensitiveWork(
        request.threadId,
        Effect.gen(function* () {
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.sendTurn",
            allowRecovery: true,
          });
          const turn = yield* routed.adapter.sendTurn(request);
          // Terminal events can settle before this write. Sharing the binding
          // lock makes settlement detection and persistence atomic.
          yield* input.withBindingWriteLock(
            request.threadId,
            Effect.gen(function* () {
              if (bindingCoordinator.consumeSettledTurn(request.threadId, String(turn.turnId))) {
                const existingBinding = Option.getOrUndefined(
                  yield* directory.getBinding(request.threadId),
                );
                yield* directory.upsert({
                  threadId: request.threadId,
                  provider: routed.adapter.provider,
                  ...(existingBinding === undefined ? { status: "stopped" as const } : {}),
                  ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
                  ...(request.modelSelection !== undefined
                    ? { runtimePayload: { modelSelection: request.modelSelection } }
                    : {}),
                });
              } else {
                yield* directory.upsert({
                  threadId: request.threadId,
                  provider: routed.adapter.provider,
                  status: "running",
                  ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
                  runtimePayload: {
                    ...(request.modelSelection !== undefined
                      ? { modelSelection: request.modelSelection }
                      : {}),
                    activeTurnId: turn.turnId,
                    lastRuntimeEvent: "provider.sendTurn",
                    lastRuntimeEventAt: new Date().toISOString(),
                  },
                });
              }
            }),
          );
          return turn;
        }),
      );
    });

  const steerTurn: ProviderServiceShape["steerTurn"] = (rawInput) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.steerTurn",
        schema: ProviderSteerTurnInput,
        payload: rawInput,
      });
      const request = { ...parsed, attachments: parsed.attachments ?? [] };
      if (!request.input && request.attachments.length === 0) {
        return yield* toValidationError(
          "ProviderService.steerTurn",
          "Either input text or at least one attachment is required",
        );
      }
      return yield* input.idle.runSensitiveWork(
        request.threadId,
        Effect.gen(function* () {
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.steerTurn",
            allowRecovery: true,
          });
          if (
            !routed.adapter.steerTurn ||
            routed.adapter.capabilities.supportsTurnSteering !== true
          ) {
            return yield* toValidationError(
              "ProviderService.steerTurn",
              `Provider '${routed.adapter.provider}' does not support steering an active turn.`,
            );
          }
          const turn = yield* routed.adapter.steerTurn(request);
          yield* directory.upsert({
            threadId: request.threadId,
            provider: routed.adapter.provider,
            status: "running",
            ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
            runtimePayload: {
              ...(request.modelSelection !== undefined
                ? { modelSelection: request.modelSelection }
                : {}),
              activeTurnId: turn.turnId,
              lastRuntimeEvent: "provider.steerTurn",
              lastRuntimeEventAt: new Date().toISOString(),
            },
          });
          return turn;
        }),
      );
    });

  const startReview: ProviderServiceShape["startReview"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.startReview",
        schema: ProviderStartReviewInput,
        payload: rawInput,
      });
      return yield* input.idle.runSensitiveWork(
        request.threadId,
        Effect.gen(function* () {
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.startReview",
            allowRecovery: true,
          });
          if (!routed.adapter.startReview) {
            return yield* toValidationError(
              "ProviderService.startReview",
              `Provider '${routed.adapter.provider}' does not support native review.`,
            );
          }
          const turn = yield* routed.adapter.startReview(request);
          yield* directory.upsert({
            threadId: request.threadId,
            provider: routed.adapter.provider,
            status: "running",
            ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
            runtimePayload: {
              activeTurnId: turn.turnId,
              lastRuntimeEvent: "provider.startReview",
              lastRuntimeEventAt: new Date().toISOString(),
            },
          });
          return turn;
        }),
      );
    });

  const interruptTurn: ProviderServiceShape["interruptTurn"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.interruptTurn",
        schema: ProviderInterruptTurnInput,
        payload: rawInput,
      });
      const routed = yield* input.resolveRoutableSession({
        threadId: request.threadId,
        operation: "ProviderService.interruptTurn",
        allowRecovery: true,
      });
      yield* routed.adapter.interruptTurn(
        routed.threadId,
        request.turnId,
        request.providerThreadId,
      );
    });

  const respondToRequest: ProviderServiceShape["respondToRequest"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.respondToRequest",
        schema: ProviderRespondToRequestInput,
        payload: rawInput,
      });
      const routed = yield* input.resolveRoutableSession({
        threadId: request.threadId,
        operation: "ProviderService.respondToRequest",
        allowRecovery: true,
      });
      yield* routed.adapter.respondToRequest(routed.threadId, request.requestId, request.decision);
    });

  const respondToUserInput: ProviderServiceShape["respondToUserInput"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.respondToUserInput",
        schema: ProviderRespondToUserInputInput,
        payload: rawInput,
      });
      const routed = yield* input.resolveRoutableSession({
        threadId: request.threadId,
        operation: "ProviderService.respondToUserInput",
        allowRecovery: true,
      });
      yield* routed.adapter.respondToUserInput(routed.threadId, request.requestId, request.answers);
    });

  return {
    sendTurn,
    steerTurn,
    startReview,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
  };
}
