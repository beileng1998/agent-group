import { ProviderForkThreadInput, ProviderSessionStartInput } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { readPersistedCwd, readPersistedProviderOptions } from "../../providerRuntimeBinding.ts";
import { startProviderSessionWithReplacement } from "../../providerSessionReplacement.ts";
import type { ProviderServiceShape } from "../../Services/ProviderService.ts";
import { decodeInputOrValidationError } from "./providerServiceInput.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  UpsertSessionBinding,
  WithBindingWriteLock,
} from "./providerServiceTypes.ts";

export function makeProviderSessionStartOperations(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly withBindingWriteLock: WithBindingWriteLock;
  readonly upsertSessionBinding: UpsertSessionBinding;
}) {
  const { registry, directory, lifecycle } = input.dependencies;

  const startSession: ProviderServiceShape["startSession"] = (threadId, rawInput) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.startSession",
        schema: ProviderSessionStartInput,
        payload: rawInput,
      });
      const request = { ...parsed, threadId, provider: parsed.provider ?? "codex" };
      input.idle.clearTimer(threadId);
      yield* input.idle.waitForStop(threadId);
      return yield* lifecycle.run(threadId, () =>
        Effect.gen(function* () {
          input.idle.clearTimer(threadId);
          return yield* startProviderSessionWithReplacement({
            threadId,
            sessionInput: request,
            registry,
            directory,
            persistSession: (session, metadata) =>
              input.withBindingWriteLock(
                threadId,
                input.upsertSessionBinding(session, threadId, metadata),
              ),
          });
        }),
      );
    });

  const forkThread: NonNullable<ProviderServiceShape["forkThread"]> = (rawInput) =>
    Effect.gen(function* () {
      const request = yield* decodeInputOrValidationError({
        operation: "ProviderService.forkThread",
        schema: ProviderForkThreadInput,
        payload: rawInput,
      });
      const sourceBinding = Option.getOrUndefined(
        yield* directory.getBinding(request.sourceThreadId),
      );
      if (!sourceBinding) return null;
      const existingTargetBinding = Option.getOrUndefined(
        yield* directory.getBinding(request.threadId),
      );
      if (existingTargetBinding) return null;

      const effectiveProviderOptions =
        request.providerOptions ?? readPersistedProviderOptions(sourceBinding.runtimePayload);
      const sourceCwd = readPersistedCwd(sourceBinding.runtimePayload);
      const adapter = yield* registry.getByProvider(sourceBinding.provider);
      if (!adapter.forkThread) return null;
      if (
        request.modelSelection !== undefined &&
        request.modelSelection.provider !== adapter.provider
      ) {
        return null;
      }

      const forked = yield* adapter
        .forkThread({
          ...request,
          threadId: request.threadId,
          sourceThreadId: request.sourceThreadId,
          ...(effectiveProviderOptions !== undefined
            ? { providerOptions: effectiveProviderOptions }
            : {}),
          ...(sourceBinding.resumeCursor !== null && sourceBinding.resumeCursor !== undefined
            ? { sourceResumeCursor: sourceBinding.resumeCursor }
            : {}),
          ...(sourceCwd ? { sourceCwd } : {}),
          runtimeMode: request.runtimeMode,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("provider native fork failed; falling back", {
              sourceThreadId: request.sourceThreadId,
              targetThreadId: request.threadId,
              cause: error instanceof Error ? error.message : String(error),
            }).pipe(Effect.as(null)),
          ),
        );
      if (!forked) return null;

      const forkedSession = (yield* adapter.listSessions()).find(
        (session) => session.threadId === request.threadId,
      );
      if (forkedSession) {
        yield* input.upsertSessionBinding(forkedSession, request.threadId, {
          ...(request.modelSelection !== undefined
            ? { modelSelection: request.modelSelection }
            : {}),
          ...(effectiveProviderOptions !== undefined
            ? { providerOptions: effectiveProviderOptions }
            : {}),
          lastRuntimeEvent: "provider.thread.forked",
          lastRuntimeEventAt: new Date().toISOString(),
        });
      } else {
        yield* directory.upsert({
          threadId: request.threadId,
          provider: adapter.provider,
          runtimeMode: request.runtimeMode,
          status: "stopped",
          ...(forked.resumeCursor !== undefined ? { resumeCursor: forked.resumeCursor } : {}),
          runtimePayload: {
            cwd: request.cwd ?? null,
            model: request.modelSelection?.model ?? null,
            activeTurnId: null,
            lastError: null,
            ...(request.modelSelection !== undefined
              ? { modelSelection: request.modelSelection }
              : {}),
            ...(effectiveProviderOptions !== undefined
              ? { providerOptions: effectiveProviderOptions }
              : {}),
            lastRuntimeEvent: "provider.thread.forked",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
      }
      return forked;
    });

  return { startSession, forkThread };
}
