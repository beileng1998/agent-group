import { ProviderStopSessionInput } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { hasResumeCursor, runtimePayloadRecord } from "../../providerRuntimeBinding.ts";
import type { ProviderServiceShape } from "../../Services/ProviderService.ts";
import { decodeInputOrValidationError } from "./providerServiceInput.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  ResolveRoutableSession,
  WithBindingWriteLock,
} from "./providerServiceTypes.ts";

type StopRuntimeSession = NonNullable<ProviderServiceShape["stopRuntimeSession"]>;
type StopRuntimeSessionInput = Parameters<StopRuntimeSession>[0];
type StopRuntimeSessionEffect = ReturnType<StopRuntimeSession>;

export function makeProviderSessionStopOperations(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly resolveRoutableSession: ResolveRoutableSession;
  readonly withBindingWriteLock: WithBindingWriteLock;
}) {
  const { registry, directory, lifecycle, boundProvidersByThread } = input.dependencies;

  const stopSession: ProviderServiceShape["stopSession"] = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.stopSession",
        schema: ProviderStopSessionInput,
        payload: rawInput,
      });
      yield* input.idle.waitForStop(request.threadId);
      input.idle.clearTimer(request.threadId);
      yield* lifecycle.run(request.threadId, () =>
        Effect.gen(function* () {
          input.idle.clearTimer(request.threadId);
          const routed = yield* input.resolveRoutableSession({
            threadId: request.threadId,
            operation: "ProviderService.stopSession",
            allowRecovery: false,
          });
          if (routed.isActive) yield* routed.adapter.stopSession(routed.threadId);
          yield* input.withBindingWriteLock(request.threadId, directory.remove(request.threadId));
          boundProvidersByThread.delete(request.threadId);
          input.idle.retireGeneration(request.threadId);
        }),
      );
      yield* input.idle.waitForStop(request.threadId);
    });

  const stopRuntimeSessionInternal = (
    rawInput: StopRuntimeSessionInput,
    expectedIdleGeneration?: symbol,
  ): StopRuntimeSessionEffect =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.stopRuntimeSession",
        schema: ProviderStopSessionInput,
        payload: rawInput,
      });
      const isExpectedIdleStopCurrent = () =>
        expectedIdleGeneration === undefined ||
        input.idle.isGenerationCurrent(request.threadId, expectedIdleGeneration);
      if (expectedIdleGeneration === undefined) {
        yield* input.idle.waitForStop(request.threadId);
        input.idle.clearTimer(request.threadId);
      } else if (!isExpectedIdleStopCurrent()) {
        return;
      }
      return yield* lifecycle.run(request.threadId, () =>
        Effect.gen(function* () {
          if (expectedIdleGeneration === undefined) input.idle.clearTimer(request.threadId);
          if (!isExpectedIdleStopCurrent()) return;
          const binding = Option.getOrUndefined(yield* directory.getBinding(request.threadId));
          if (!binding || !isExpectedIdleStopCurrent()) return;
          const adapter = yield* registry.getByProvider(binding.provider);
          const hasActiveSession = yield* adapter.hasSession(request.threadId);
          if (!isExpectedIdleStopCurrent()) return;
          if (hasActiveSession) yield* adapter.stopSession(request.threadId);
          if (!isExpectedIdleStopCurrent()) return;
          yield* input.withBindingWriteLock(
            request.threadId,
            directory.upsert({
              threadId: request.threadId,
              provider: binding.provider,
              ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
              ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
              status: "stopped",
              resumeCursor: binding.resumeCursor,
              runtimePayload: {
                ...(binding.runtimePayload &&
                typeof binding.runtimePayload === "object" &&
                !Array.isArray(binding.runtimePayload)
                  ? binding.runtimePayload
                  : {}),
                activeTurnId: null,
                lastRuntimeEvent: "provider.stopRuntimeSession",
                lastRuntimeEventAt: new Date().toISOString(),
              },
            }),
          );
          input.idle.retireGeneration(request.threadId, expectedIdleGeneration);
        }),
      );
    });

  const stopRuntimeSession: StopRuntimeSession = (rawInput) => stopRuntimeSessionInternal(rawInput);

  input.idle.setStopHandler((threadId, generation) => {
    const stopEffect = Effect.gen(function* () {
      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      if (!binding) {
        input.idle.retireGeneration(threadId, generation);
        return;
      }
      const adapter = yield* registry.getByProvider(binding.provider);
      const sessions = yield* adapter.listSessions();
      const session = sessions.find((entry) => entry.threadId === threadId);
      const bindingRuntimePayload = runtimePayloadRecord(binding.runtimePayload);
      const isIdleReadySession =
        session?.status === "ready" ||
        (session?.status === "running" &&
          session.activeTurnId === undefined &&
          binding.status === "stopped" &&
          (bindingRuntimePayload.lastRuntimeEvent === "thread.state.changed" ||
            bindingRuntimePayload.lastRuntimeEvent === "provider.compactThread"));
      if (!session || !isIdleReadySession || session.activeTurnId !== undefined) {
        input.idle.retireGeneration(threadId, generation);
        return;
      }
      if (!hasResumeCursor(session.resumeCursor) && !hasResumeCursor(binding.resumeCursor)) {
        input.idle.retireGeneration(threadId, generation);
        return;
      }
      if (!input.idle.isGenerationCurrent(threadId, generation)) return;
      yield* stopRuntimeSessionInternal({ threadId }, generation);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider.session.idle_stop_failed", { threadId, cause }),
      ),
    );
    input.idle.trackStop(threadId, stopEffect);
  });

  const clearSessionResumeCursor: NonNullable<ProviderServiceShape["clearSessionResumeCursor"]> = (
    rawInput,
  ) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.clearSessionResumeCursor",
        schema: ProviderStopSessionInput,
        payload: rawInput,
      });
      yield* input.idle.waitForStop(request.threadId);
      input.idle.clearTimer(request.threadId);
      yield* lifecycle.run(request.threadId, () =>
        Effect.gen(function* () {
          input.idle.clearTimer(request.threadId);
          const initialBinding = Option.getOrUndefined(
            yield* directory.getBinding(request.threadId),
          );
          if (!initialBinding) return;
          const adapter = yield* registry.getByProvider(initialBinding.provider);
          if (yield* adapter.hasSession(request.threadId)) {
            yield* adapter.stopSession(request.threadId);
          }
          yield* input.withBindingWriteLock(
            request.threadId,
            Effect.gen(function* () {
              const binding = Option.getOrUndefined(yield* directory.getBinding(request.threadId));
              if (!binding) return;
              yield* directory.upsert({
                threadId: request.threadId,
                provider: binding.provider,
                ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
                ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
                status: "stopped",
                resumeCursor: null,
                runtimePayload: binding.runtimePayload,
              });
            }),
          );
        }),
      );
      yield* input.idle.waitForStop(request.threadId);
      input.idle.retireGeneration(request.threadId);
    });

  return { stopSession, stopRuntimeSession, clearSessionResumeCursor };
}
