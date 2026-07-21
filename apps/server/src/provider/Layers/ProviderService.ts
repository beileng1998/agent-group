/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * @module ProviderServiceLive
 */
import type { ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { makeProviderBindingCoordinator } from "../providerBindingCoordinator.ts";
import { makeProviderLifecycleCoordinator } from "../providerLifecycleCoordinator.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { makeProviderConversationMaintenance } from "./provider-service/providerConversationMaintenance.ts";
import {
  makeProviderRuntimeIdleLifecycle,
  resolveProviderRuntimeIdleStopMs,
} from "./provider-service/providerRuntimeIdleLifecycle.ts";
import { makeProviderRuntimeBindings } from "./provider-service/providerRuntimeBindings.ts";
import type { ProviderServiceDependencies } from "./provider-service/providerServiceTypes.ts";
import { makeProviderSessionQueries } from "./provider-service/providerSessionQueries.ts";
import { makeProviderSessionRouting } from "./provider-service/providerSessionRouting.ts";
import { makeProviderSessionStartOperations } from "./provider-service/providerSessionStartOperations.ts";
import { makeProviderSessionStopOperations } from "./provider-service/providerSessionStopOperations.ts";
import { makeProviderTurnOperations } from "./provider-service/providerTurnOperations.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
  readonly runtimeIdleStopMs?: number;
}

const makeProviderService = (options?: ProviderServiceLiveOptions) =>
  Effect.gen(function* () {
    const canonicalEventLogger =
      options?.canonicalEventLogger ??
      (options?.canonicalEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, { stream: "canonical" })
        : undefined);

    const registry = yield* ProviderAdapterRegistry;
    const directory = yield* ProviderSessionDirectory;
    const lifecycle = makeProviderLifecycleCoordinator();
    const bindingCoordinator = makeProviderBindingCoordinator();
    const boundProvidersByThread = new Map<ThreadId, ProviderRuntimeBinding["provider"]>();
    for (const binding of yield* directory.listBindings()) {
      boundProvidersByThread.set(binding.threadId, binding.provider);
    }
    const providers = yield* registry.listProviders();
    const adapters = yield* Effect.forEach(providers, (provider) =>
      registry.getByProvider(provider),
    );
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const idle = makeProviderRuntimeIdleLifecycle(
      resolveProviderRuntimeIdleStopMs(options?.runtimeIdleStopMs),
    );
    const dependencies: ProviderServiceDependencies = {
      registry,
      directory,
      adapters,
      lifecycle,
      bindingCoordinator,
      boundProvidersByThread,
    };

    const runtimeBindings = makeProviderRuntimeBindings({
      dependencies,
      idle,
      runtimeEventPubSub,
      ...(canonicalEventLogger !== undefined ? { canonicalEventLogger } : {}),
    });

    // Fan provider events straight into the pubsub so high-volume streams do
    // not pay for an extra queue hop in the hot path.
    yield* Effect.forEach(adapters, (adapter) =>
      Stream.runForEach(adapter.streamEvents, runtimeBindings.processRuntimeEvent).pipe(
        Effect.forkScoped,
      ),
    ).pipe(Effect.asVoid);

    const routing = makeProviderSessionRouting({
      dependencies,
      idle,
      withBindingWriteLock: runtimeBindings.withBindingWriteLock,
      upsertSessionBinding: runtimeBindings.upsertSessionBinding,
    });
    const sessionStart = makeProviderSessionStartOperations({
      dependencies,
      idle,
      withBindingWriteLock: runtimeBindings.withBindingWriteLock,
      upsertSessionBinding: runtimeBindings.upsertSessionBinding,
    });
    const turns = makeProviderTurnOperations({
      dependencies,
      idle,
      resolveRoutableSession: routing.resolveRoutableSession,
      withBindingWriteLock: runtimeBindings.withBindingWriteLock,
    });
    const sessionStop = makeProviderSessionStopOperations({
      dependencies,
      idle,
      resolveRoutableSession: routing.resolveRoutableSession,
      withBindingWriteLock: runtimeBindings.withBindingWriteLock,
    });
    const queries = makeProviderSessionQueries(dependencies);
    const maintenance = makeProviderConversationMaintenance({
      dependencies,
      idle,
      resolveRoutableSession: routing.resolveRoutableSession,
      clearSessionResumeCursor: sessionStop.clearSessionResumeCursor,
    });

    const runStopAll = () =>
      Effect.gen(function* () {
        const stoppedAt = new Date().toISOString();
        const threadIds = yield* directory.listThreadIds();
        const activeSessions = yield* Effect.forEach(adapters, (adapter) =>
          adapter.listSessions(),
        ).pipe(
          Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)),
        );
        yield* Effect.forEach(activeSessions, (session) =>
          runtimeBindings.upsertStoppedSessionBinding(session, stoppedAt),
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(threadIds, (threadId) =>
          runtimeBindings.markPersistedThreadStopped(threadId, stoppedAt),
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(adapters, (adapter) => adapter.stopAll()).pipe(Effect.asVoid);
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => idle.dispose()).pipe(
        Effect.andThen(runStopAll()),
        Effect.catch((cause) => Effect.logWarning("failed to stop provider service", { cause })),
      ),
    );

    return {
      ...sessionStart,
      ...turns,
      ...sessionStop,
      ...queries,
      ...maintenance,
      // Each access creates a fresh subscription so every consumer receives
      // all provider runtime events independently.
      get streamEvents(): ProviderServiceShape["streamEvents"] {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    } satisfies ProviderServiceShape;
  });

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}
