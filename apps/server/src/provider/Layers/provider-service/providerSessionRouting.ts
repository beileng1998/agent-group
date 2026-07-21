import type { ThreadId } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import {
  hasResumeCursor,
  readPersistedCwd,
  readPersistedModelSelection,
  readPersistedProviderOptions,
} from "../../providerRuntimeBinding.ts";
import type { ProviderRuntimeBinding } from "../../Services/ProviderSessionDirectory.ts";
import { toValidationError } from "./providerServiceInput.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  ResolveRoutableSession,
  UpsertSessionBinding,
  WithBindingWriteLock,
} from "./providerServiceTypes.ts";

export function makeProviderSessionRouting(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly withBindingWriteLock: WithBindingWriteLock;
  readonly upsertSessionBinding: UpsertSessionBinding;
}) {
  const { registry, directory, lifecycle, adapters } = input.dependencies;

  const recoverSessionForThread = (request: {
    readonly binding: ProviderRuntimeBinding;
    readonly operation: string;
  }) =>
    lifecycle.run(request.binding.threadId, () =>
      Effect.gen(function* () {
        input.idle.clearTimer(request.binding.threadId);
        const binding = Option.getOrUndefined(
          yield* directory.getBinding(request.binding.threadId),
        );
        if (!binding) {
          return yield* toValidationError(
            request.operation,
            `Cannot recover thread '${request.binding.threadId}' because its provider binding was removed.`,
          );
        }
        const adapter = yield* registry.getByProvider(binding.provider);
        const hasPersistedResumeCursor = hasResumeCursor(binding.resumeCursor);
        const hasActiveSession = yield* adapter.hasSession(binding.threadId);
        if (hasActiveSession) {
          const activeSessions = yield* adapter.listSessions();
          const existing = activeSessions.find((session) => session.threadId === binding.threadId);
          if (existing) {
            yield* input.withBindingWriteLock(
              binding.threadId,
              input.upsertSessionBinding(existing, binding.threadId),
            );
            return { adapter, session: existing } as const;
          }
        }

        if (!hasPersistedResumeCursor) {
          return yield* toValidationError(
            request.operation,
            `Cannot recover thread '${binding.threadId}' because no provider resume state is persisted.`,
          );
        }

        const persistedCwd = readPersistedCwd(binding.runtimePayload);
        const persistedModelSelection = readPersistedModelSelection(binding.runtimePayload);
        const persistedProviderOptions = readPersistedProviderOptions(binding.runtimePayload);
        const resumed = yield* adapter.startSession({
          threadId: binding.threadId,
          provider: binding.provider,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(persistedProviderOptions ? { providerOptions: persistedProviderOptions } : {}),
          ...(hasPersistedResumeCursor ? { resumeCursor: binding.resumeCursor } : {}),
          runtimeMode: binding.runtimeMode ?? "full-access",
        });
        if (resumed.provider !== adapter.provider) {
          return yield* toValidationError(
            request.operation,
            `Adapter/provider mismatch while recovering thread '${binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
          );
        }

        yield* input.withBindingWriteLock(
          binding.threadId,
          input.upsertSessionBinding(resumed, binding.threadId),
        );
        return { adapter, session: resumed } as const;
      }),
    );

  const findLiveSessionAdapter = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const matches = yield* Effect.forEach(
        adapters,
        (adapter) =>
          adapter.hasSession(threadId).pipe(
            Effect.map((hasSession) => (hasSession ? adapter : null)),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: "unbounded" },
      );
      return matches.find((adapter) => adapter !== null) ?? null;
    });

  const resolveRoutableSession: ResolveRoutableSession = (request) =>
    Effect.gen(function* () {
      const binding = Option.getOrUndefined(yield* directory.getBinding(request.threadId));
      if (!binding) {
        // Startup extension prompts can fire before startSession persists the
        // binding while the adapter already owns a live session.
        const liveAdapter = yield* findLiveSessionAdapter(request.threadId);
        if (liveAdapter) {
          return { adapter: liveAdapter, threadId: request.threadId, isActive: true } as const;
        }
        return yield* toValidationError(
          request.operation,
          `Cannot route thread '${request.threadId}' because no persisted provider binding exists.`,
        );
      }
      const adapter = yield* registry.getByProvider(binding.provider);
      const hasRequestedSession = yield* adapter.hasSession(request.threadId);
      if (hasRequestedSession) {
        return { adapter, threadId: request.threadId, isActive: true } as const;
      }
      if (!request.allowRecovery) {
        return { adapter, threadId: request.threadId, isActive: false } as const;
      }

      const recovered = yield* recoverSessionForThread({
        binding,
        operation: request.operation,
      });
      return { adapter: recovered.adapter, threadId: request.threadId, isActive: true } as const;
    });

  return { resolveRoutableSession };
}
