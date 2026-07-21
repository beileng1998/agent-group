import type { ProviderRuntimeEvent, ProviderSession, ThreadId } from "@agent-group/contracts";
import type { Effect } from "effect";

import type { ProviderAdapterError, ProviderServiceError } from "../../Errors.ts";
import type { ProviderBindingCoordinator } from "../../providerBindingCoordinator.ts";
import type { ProviderLifecycleCoordinator } from "../../providerLifecycleCoordinator.ts";
import type { ProviderAdapterShape } from "../../Services/ProviderAdapter.ts";
import type { ProviderAdapterRegistryShape } from "../../Services/ProviderAdapterRegistry.ts";
import type {
  ProviderRuntimeBinding,
  ProviderSessionDirectoryShape,
} from "../../Services/ProviderSessionDirectory.ts";

export type AnyProviderAdapter = ProviderAdapterShape<ProviderAdapterError>;

export interface RoutedProviderSession {
  readonly adapter: AnyProviderAdapter;
  readonly threadId: ThreadId;
  readonly isActive: boolean;
}

export type ResolveRoutableSession = (input: {
  readonly threadId: ThreadId;
  readonly operation: string;
  readonly allowRecovery: boolean;
}) => Effect.Effect<RoutedProviderSession, ProviderServiceError>;

export type WithBindingWriteLock = ProviderBindingCoordinator["withWriteLock"];

export type UpsertSessionBinding = (
  session: ProviderSession,
  threadId: ThreadId,
  extra?: {
    readonly modelSelection?: unknown;
    readonly providerOptions?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
) => Effect.Effect<void, ProviderServiceError>;

export interface ProviderServiceDependencies {
  readonly registry: ProviderAdapterRegistryShape;
  readonly directory: ProviderSessionDirectoryShape;
  readonly adapters: ReadonlyArray<AnyProviderAdapter>;
  readonly lifecycle: ProviderLifecycleCoordinator;
  readonly bindingCoordinator: ProviderBindingCoordinator;
  readonly boundProvidersByThread: Map<ThreadId, ProviderRuntimeBinding["provider"]>;
}

export interface ProviderRuntimeIdleLifecycle {
  readonly clearTimer: (threadId: ThreadId) => void;
  readonly scheduleStop: (threadId: ThreadId) => void;
  readonly waitForStop: (threadId: ThreadId) => Effect.Effect<void>;
  readonly runSensitiveWork: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
    options?: { readonly scheduleIdleStopOnSuccess?: boolean },
  ) => Effect.Effect<A, E, R>;
  readonly reconcileEvent: (event: ProviderRuntimeEvent) => void;
  readonly isGenerationCurrent: (threadId: ThreadId, generation: symbol) => boolean;
  readonly retireGeneration: (threadId: ThreadId, generation?: symbol) => void;
  readonly setStopHandler: (
    handler: ((threadId: ThreadId, generation: symbol) => void) | null,
  ) => void;
  readonly trackStop: (threadId: ThreadId, stopEffect: Effect.Effect<void>) => void;
  readonly dispose: () => void;
}
