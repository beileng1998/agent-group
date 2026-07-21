import { ProviderCompactThreadInput } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { runtimePayloadRecord } from "../../providerRuntimeBinding.ts";
import type { ProviderServiceShape } from "../../Services/ProviderService.ts";
import {
  decodeInputOrValidationError,
  ProviderRollbackConversationInput,
  toValidationError,
} from "./providerServiceInput.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  ResolveRoutableSession,
} from "./providerServiceTypes.ts";

export function makeProviderConversationMaintenance(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly resolveRoutableSession: ResolveRoutableSession;
  readonly clearSessionResumeCursor: NonNullable<ProviderServiceShape["clearSessionResumeCursor"]>;
}) {
  const { directory } = input.dependencies;

  const rollbackConversation: ProviderServiceShape["rollbackConversation"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.rollbackConversation",
        schema: ProviderRollbackConversationInput,
        payload: rawInput,
      });
      if (request.numTurns === 0) return;
      yield* input.idle.runSensitiveWork(
        request.threadId,
        Effect.gen(function* () {
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.rollbackConversation",
            // Restart-based rollback only needs the persisted binding and must
            // not replay the stale native cursor merely to close it again.
            allowRecovery: false,
          });
          if (routed.adapter.capabilities.conversationRollback === "restart-session") {
            yield* input.clearSessionResumeCursor({ threadId: request.threadId });
          } else {
            const active = routed.isActive
              ? routed
              : yield* input.resolveRoutableSession({
                  threadId: request.threadId,
                  operation: "ProviderService.rollbackConversation",
                  allowRecovery: true,
                });
            yield* active.adapter.rollbackThread(active.threadId, request.numTurns);
          }
        }),
        { scheduleIdleStopOnSuccess: true },
      );
    });

  const compactThread: ProviderServiceShape["compactThread"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.compactThread",
        schema: ProviderCompactThreadInput,
        payload: rawInput,
      });
      yield* input.idle.runSensitiveWork(
        request.threadId,
        Effect.gen(function* () {
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.compactThread",
            allowRecovery: true,
          });
          if (!routed.adapter.compactThread) {
            return yield* toValidationError(
              "ProviderService.compactThread",
              `Context compaction is unavailable for provider '${routed.adapter.provider}'.`,
            );
          }
          yield* routed.adapter.compactThread(routed.threadId);
          const binding = Option.getOrUndefined(yield* directory.getBinding(routed.threadId));
          if (binding) {
            yield* directory.upsert({
              threadId: routed.threadId,
              provider: binding.provider,
              ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
              ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
              status: "stopped",
              resumeCursor: binding.resumeCursor,
              runtimePayload: {
                ...runtimePayloadRecord(binding.runtimePayload),
                activeTurnId: null,
                lastRuntimeEvent: "provider.compactThread",
                lastRuntimeEventAt: new Date().toISOString(),
              },
            });
          }
        }),
        { scheduleIdleStopOnSuccess: true },
      );
    });

  return { rollbackConversation, compactThread };
}
