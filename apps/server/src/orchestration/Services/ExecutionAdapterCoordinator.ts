// FILE: ExecutionAdapterCoordinator.ts
// Purpose: The only facade allowed to mutate structured/terminal runtimes.
// Layer: Server orchestration service contract

import type { ProviderKind, ProviderSession, ThreadId } from "@agent-group/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  TerminalHostAttachResult,
  TerminalHostExit,
  TerminalHostGeneration,
  TerminalHostOutput,
} from "../../terminalHost/TerminalHost";
import type {
  ExecutionAdapterAuthorityChange,
  ExecutionAdapterAuthorityState,
  TerminalAdmissionClaim,
  TerminalAuthorityState,
} from "./ExecutionAdapterAuthority";

export class ExecutionAdapterError extends Schema.TaggedErrorClass<ExecutionAdapterError>()(
  "ExecutionAdapterError",
  {
    reason: Schema.Literals([
      "turn-in-flight",
      "unsupported-provider",
      "not-structured",
      "not-terminal",
      "stale-revision",
      "stale-generation",
      "host",
      "structured-runtime",
      "compensation-failed",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export type ExecutionAdapterState = ExecutionAdapterAuthorityState;
export type ExecutionAdapterChange = ExecutionAdapterAuthorityChange;
export type ExecutionAdapterOwner = ExecutionAdapterState["adapter"];

/** Internal-only launch plan built by a trusted provider driver. */
export interface ExecutionAdapterSpawnSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

export interface ExecutionAdapterSwitchResult {
  readonly isNew: boolean;
  readonly revision: number;
  readonly runtimeInstanceId: string;
  readonly generation: TerminalHostGeneration;
  readonly pid: number;
}

export interface ExecutionAdapterPreparedSpawn {
  readonly providerSessionId: string | null;
  readonly spawn: ExecutionAdapterSpawnSpec;
}

export type TerminalAuthorityPatch = Partial<
  Pick<
    TerminalAuthorityState,
    | "status"
    | "pid"
    | "ownerIdentity"
    | "processGroupIdentity"
    | "providerSessionId"
    | "activeTurnId"
    | "exitCode"
    | "exitSignal"
    | "error"
  >
>;

export interface ExecutionAdapterCoordinatorShape {
  readonly getState: (threadId: ThreadId) => Effect.Effect<ExecutionAdapterState>;
  readonly streamChanges: Stream.Stream<ExecutionAdapterChange>;
  readonly isTerminalHostAlive: (threadId: ThreadId) => Effect.Effect<boolean>;
  readonly acquireTerminalOperation: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly claimId: string;
  }) => Effect.Effect<TerminalAdmissionClaim, ExecutionAdapterError>;
  readonly switchToTerminal: (input: {
    readonly threadId: ThreadId;
    readonly provider: ProviderKind;
    readonly runtimeInstanceId: string;
    readonly prepare: (
      session: ProviderSession | undefined,
    ) => Effect.Effect<ExecutionAdapterPreparedSpawn, unknown>;
  }) => Effect.Effect<ExecutionAdapterSwitchResult, ExecutionAdapterError>;
  readonly restartTerminal: (input: {
    readonly threadId: ThreadId;
    readonly provider: ProviderKind;
    readonly runtimeInstanceId: string;
    readonly providerSessionId?: string | null;
    readonly spawn: ExecutionAdapterSpawnSpec;
  }) => Effect.Effect<ExecutionAdapterSwitchResult, ExecutionAdapterError>;
  /** Stop the PTY while retaining terminal authority and its visible exit state. */
  readonly stopTerminal: (threadId: ThreadId) => Effect.Effect<void, ExecutionAdapterError>;
  /** Compensate a failed launch while preserving the live Thread. */
  readonly abortTerminalLaunch: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly restoreStructured: boolean;
  }) => Effect.Effect<void, ExecutionAdapterError>;
  /**
   * Re-read authority and stop the owning adapter under the transition lock.
   * Callbacks are lazy so no provider or hook effect begins before ownership is
   * known.
   */
  readonly stopCurrentAdapter: (input: {
    readonly threadId: ThreadId;
    readonly beforeTerminalStop: () => Effect.Effect<void, unknown>;
    readonly stopStructured: () => Effect.Effect<void, unknown>;
  }) => Effect.Effect<ExecutionAdapterOwner, ExecutionAdapterError>;
  readonly switchToStructured: (threadId: ThreadId) => Effect.Effect<void, ExecutionAdapterError>;
  readonly attachClient: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly onOutput: (output: TerminalHostOutput) => void;
    readonly onExit: (exit: TerminalHostExit) => void;
  }) => Effect.Effect<
    { readonly attached: TerminalHostAttachResult; readonly unsubscribe: () => void },
    ExecutionAdapterError
  >;
  readonly write: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly data: string;
  }) => Effect.Effect<void, ExecutionAdapterError>;
  readonly resize: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly cols: number;
    readonly rows: number;
  }) => Effect.Effect<void, ExecutionAdapterError>;
  readonly updateTerminalState: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation?: TerminalHostGeneration;
    readonly patch: TerminalAuthorityPatch;
  }) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterError>;
  /** Deletion must observe failure so data purge can be deferred and retried. */
  readonly teardownThread: (threadId: ThreadId) => Effect.Effect<void, ExecutionAdapterError>;
  /** Forget the durable deletion tombstone only after every cleanup succeeds. */
  readonly finalizeThreadDeletion: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ExecutionAdapterError>;
}

export class ExecutionAdapterCoordinator extends ServiceMap.Service<
  ExecutionAdapterCoordinator,
  ExecutionAdapterCoordinatorShape
>()("agent-group/orchestration/Services/ExecutionAdapterCoordinator") {}
