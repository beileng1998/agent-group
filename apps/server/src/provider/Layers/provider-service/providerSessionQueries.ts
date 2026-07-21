import { stat } from "node:fs/promises";
import path from "node:path";

import type { ProviderSession, ThreadId } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProviderServiceShape } from "../../Services/ProviderService.ts";
import type { ProviderRuntimeBinding } from "../../Services/ProviderSessionDirectory.ts";
import type { ProviderServiceDependencies } from "./providerServiceTypes.ts";

export function makeProviderSessionQueries(input: ProviderServiceDependencies) {
  const { registry, directory, adapters } = input;

  const listSessions: ProviderServiceShape["listSessions"] = () =>
    Effect.gen(function* () {
      const sessionsByProvider = yield* Effect.forEach(adapters, (adapter) =>
        adapter.listSessions(),
      );
      const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
      const persistedBindings = yield* directory.listThreadIds().pipe(
        Effect.flatMap((threadIds) =>
          Effect.forEach(
            threadIds,
            (threadId) =>
              directory
                .getBinding(threadId)
                .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
            { concurrency: "unbounded" },
          ),
        ),
        Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
      );
      const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
      for (const bindingOption of persistedBindings) {
        const binding = Option.getOrUndefined(bindingOption);
        if (binding) bindingsByThreadId.set(binding.threadId, binding);
      }

      return activeSessions.map((session) => {
        const binding = bindingsByThreadId.get(session.threadId);
        if (!binding) return session;
        const overrides: {
          resumeCursor?: ProviderSession["resumeCursor"];
          runtimeMode?: ProviderSession["runtimeMode"];
        } = {};
        if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
          overrides.resumeCursor = binding.resumeCursor;
        }
        if (binding.runtimeMode !== undefined) overrides.runtimeMode = binding.runtimeMode;
        return Object.assign({}, session, overrides);
      });
    });

  const resolveTranscriptPath: NonNullable<ProviderServiceShape["resolveTranscriptPath"]> = (
    request,
  ) =>
    Effect.gen(function* () {
      const binding = Option.getOrUndefined(yield* directory.getBinding(request.threadId));
      if (!binding) return null;
      const adapter = yield* registry.getByProvider(binding.provider);
      if (!adapter.resolveTranscriptPath) return null;
      const candidate = yield* adapter.resolveTranscriptPath({
        threadId: request.threadId,
        ...(binding.resumeCursor !== undefined ? { resumeCursor: binding.resumeCursor } : {}),
        ...(binding.runtimePayload !== undefined ? { runtimePayload: binding.runtimePayload } : {}),
      });
      if (!candidate || !path.isAbsolute(candidate)) return null;
      const isFile = yield* Effect.tryPromise(() =>
        stat(candidate).then((info) => info.isFile()),
      ).pipe(Effect.orElseSucceed(() => false));
      return isFile ? candidate : null;
    });

  const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
    registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));

  return { listSessions, resolveTranscriptPath, getCapabilities };
}
