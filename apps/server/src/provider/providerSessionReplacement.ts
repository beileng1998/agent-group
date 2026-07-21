import type {
  ModelSelection,
  ProviderKind,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStartOptions,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Exit, Option } from "effect";

import { ProviderValidationError } from "./Errors.ts";
import {
  readPersistedCwd,
  readPersistedModelSelection,
  readPersistedProviderOptions,
} from "./providerRuntimeBinding.ts";
import type { ProviderAdapterRegistryShape } from "./Services/ProviderAdapterRegistry.ts";
import type { ProviderSessionDirectoryShape } from "./Services/ProviderSessionDirectory.ts";

export interface ProviderSessionBindingMetadata {
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
}

interface StartProviderSessionInput<E, R> {
  readonly threadId: ThreadId;
  readonly sessionInput: ProviderSessionStartInput & { readonly provider: ProviderKind };
  readonly registry: ProviderAdapterRegistryShape;
  readonly directory: ProviderSessionDirectoryShape;
  readonly persistSession: (
    session: ProviderSession,
    metadata: ProviderSessionBindingMetadata,
  ) => Effect.Effect<void, E, R>;
}

const adapterMismatch = (operation: string, expected: ProviderKind, received: ProviderKind) =>
  new ProviderValidationError({
    operation,
    issue: `Adapter/provider mismatch: expected '${expected}', received '${received}'.`,
  });

/** Performs one cross-provider ownership replacement with failure compensation. */
export function startProviderSessionWithReplacement<E, R>(input: StartProviderSessionInput<E, R>) {
  return Effect.gen(function* () {
    const persistedBinding = Option.getOrUndefined(
      yield* input.directory.getBinding(input.threadId),
    );
    const effectiveResumeCursor =
      input.sessionInput.resumeCursor ??
      (persistedBinding?.provider === input.sessionInput.provider
        ? persistedBinding.resumeCursor
        : undefined);
    const effectiveProviderOptions =
      input.sessionInput.providerOptions ??
      (persistedBinding?.provider === input.sessionInput.provider
        ? readPersistedProviderOptions(persistedBinding.runtimePayload)
        : undefined);
    const adapter = yield* input.registry.getByProvider(input.sessionInput.provider);
    let replacementAttempted = false;

    const startAndPersist = Effect.gen(function* () {
      replacementAttempted = true;
      const session = yield* adapter.startSession({
        ...input.sessionInput,
        ...(effectiveProviderOptions !== undefined
          ? { providerOptions: effectiveProviderOptions }
          : {}),
        ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
      });
      if (session.provider !== adapter.provider) {
        return yield* adapterMismatch(
          "ProviderService.startSession",
          adapter.provider,
          session.provider,
        );
      }
      yield* input.persistSession(session, {
        ...(input.sessionInput.modelSelection !== undefined
          ? { modelSelection: input.sessionInput.modelSelection }
          : {}),
        ...(effectiveProviderOptions !== undefined
          ? { providerOptions: effectiveProviderOptions }
          : {}),
      });
      return session;
    });

    if (!persistedBinding || persistedBinding.provider === input.sessionInput.provider) {
      return yield* startAndPersist;
    }

    const previousAdapter = yield* input.registry.getByProvider(persistedBinding.provider);
    const previousWasActive = yield* previousAdapter.hasSession(input.threadId);
    const previousModelSelection = readPersistedModelSelection(persistedBinding.runtimePayload);
    const previousProviderOptions = readPersistedProviderOptions(persistedBinding.runtimePayload);
    const previousCwd = readPersistedCwd(persistedBinding.runtimePayload);
    if (previousWasActive) {
      yield* previousAdapter.stopSession(input.threadId);
    }

    return yield* startAndPersist.pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.gen(function* () {
              if (replacementAttempted) {
                yield* adapter.stopSession(input.threadId).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("provider.session.replacement_cleanup_failed", {
                      threadId: input.threadId,
                      provider: adapter.provider,
                      cause,
                    }),
                  ),
                );
              }
              if (!previousWasActive) return;

              const restored = yield* previousAdapter.startSession({
                threadId: input.threadId,
                provider: persistedBinding.provider,
                runtimeMode: persistedBinding.runtimeMode ?? "full-access",
                ...(previousCwd !== undefined ? { cwd: previousCwd } : {}),
                ...(previousModelSelection !== undefined
                  ? { modelSelection: previousModelSelection }
                  : {}),
                ...(previousProviderOptions !== undefined
                  ? { providerOptions: previousProviderOptions }
                  : {}),
                ...(persistedBinding.resumeCursor !== undefined
                  ? { resumeCursor: persistedBinding.resumeCursor }
                  : {}),
              });
              if (restored.provider !== previousAdapter.provider) {
                return yield* adapterMismatch(
                  "ProviderService.startSession.restore",
                  previousAdapter.provider,
                  restored.provider,
                );
              }
              yield* input.persistSession(restored, {
                ...(previousModelSelection !== undefined
                  ? { modelSelection: previousModelSelection }
                  : {}),
                ...(previousProviderOptions !== undefined
                  ? { providerOptions: previousProviderOptions }
                  : {}),
              });
            }),
      ),
    );
  });
}
