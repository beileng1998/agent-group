// FILE: ExecutionAdapterAuthority.ts
// Purpose: Atomic execution-adapter authority shared by command admission,
// runtime switching, hook events, and deletion.
// Layer: Server orchestration service contract

import type { ProviderKind, ThreadId } from "@agent-group/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { TerminalHostGeneration } from "../../terminalHost/TerminalHost";
import type { TerminalOwnerIdentity } from "../../terminal/terminalProcessIdentity";
import type { TerminalProcessGroupIdentity } from "../../terminal/terminalProcessGroup";

export type ExecutionAdapterTerminalStatus =
  | "checking"
  | "starting"
  | "ready"
  | "running"
  | "attention"
  | "context-blocked"
  | "stopping"
  | "deleting"
  | "stopped"
  | "exited"
  | "error"
  | "unsupported";

export interface StructuredAuthorityState {
  readonly adapter: "structured";
  readonly revision: number;
  readonly status: "ready" | "restoring" | "stopping" | "deleting";
}

export interface TerminalAuthorityState {
  readonly adapter: "terminal";
  readonly revision: number;
  readonly provider: ProviderKind;
  readonly status: ExecutionAdapterTerminalStatus;
  readonly runtimeInstanceId: string;
  readonly generation: TerminalHostGeneration | null;
  readonly pid: number | null;
  readonly ownerIdentity: TerminalOwnerIdentity | null;
  readonly processGroupIdentity: TerminalProcessGroupIdentity | null;
  readonly providerSessionId: string | null;
  readonly activeTurnId: string | null;
  readonly startedAt: string;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
  readonly error: string | null;
}

export type ExecutionAdapterAuthorityState = StructuredAuthorityState | TerminalAuthorityState;

export interface ExecutionAdapterAuthorityChange {
  readonly threadId: ThreadId;
  readonly state: ExecutionAdapterAuthorityState;
  readonly changedAt: string;
}

export class ExecutionAdapterAuthorityError extends Schema.TaggedErrorClass<ExecutionAdapterAuthorityError>()(
  "ExecutionAdapterAuthorityError",
  {
    reason: Schema.Literals([
      "not-structured",
      "not-terminal",
      "structured-operation-active",
      "terminal-turn-active",
      "transition-in-progress",
      "stale-revision",
      "stale-generation",
      "claim-missing",
      "persistence-failed",
      "authority-unavailable",
    ]),
    message: Schema.String,
  },
) {}

export interface StructuredAdmissionClaim {
  readonly threadId: ThreadId;
  readonly claimId: string;
  readonly release: Effect.Effect<void>;
}

export interface TerminalAdmissionClaim {
  readonly threadId: ThreadId;
  readonly claimId: string;
  readonly revision: number;
  readonly generation: TerminalHostGeneration;
  readonly release: Effect.Effect<void>;
}

export interface ExecutionAdapterAuthorityShape {
  /** Non-null when durable authority could not be trusted at startup. */
  readonly safetyModeReason: string | null;
  readonly getState: (threadId: ThreadId) => Effect.Effect<ExecutionAdapterAuthorityState>;
  readonly listStates: Effect.Effect<ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>>;
  readonly streamChanges: Stream.Stream<ExecutionAdapterAuthorityChange>;
  /** Short structured operation claim used around metadata/runtime mutations. */
  readonly acquireStructured: (
    threadId: ThreadId,
    claimId: string,
  ) => Effect.Effect<StructuredAdmissionClaim, ExecutionAdapterAuthorityError>;
  /** Turn-start reservation survives command persistence until the reactor claims it. */
  readonly reserveStructuredStart: (
    threadId: ThreadId,
    claimId: string,
  ) => Effect.Effect<void, ExecutionAdapterAuthorityError>;
  readonly claimStructuredStart: (
    threadId: ThreadId,
    claimId: string,
  ) => Effect.Effect<StructuredAdmissionClaim, ExecutionAdapterAuthorityError>;
  readonly releaseStructured: (threadId: ThreadId, claimId: string) => Effect.Effect<void>;
  /** Lease a terminal epoch until its hook/projection operation has committed. */
  readonly acquireTerminal: (
    threadId: ThreadId,
    revision: number,
    generation: TerminalHostGeneration,
    claimId: string,
  ) => Effect.Effect<TerminalAdmissionClaim, ExecutionAdapterAuthorityError>;
  /** Block new structured work, then drain leases before a provider stop. */
  readonly beginStructuredStop: (
    threadId: ThreadId,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  readonly completeStructuredStop: (
    threadId: ThreadId,
    revision: number,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  /** Persist a deletion tombstone before any physical runtime cleanup. */
  readonly beginThreadDeletion: (
    threadId: ThreadId,
  ) => Effect.Effect<ExecutionAdapterAuthorityState, ExecutionAdapterAuthorityError>;
  readonly completeTerminalDeletion: (
    threadId: ThreadId,
    revision: number,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  readonly awaitClaimsDrained: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ExecutionAdapterAuthorityError>;
  readonly beginTerminalSwitch: (input: {
    readonly threadId: ThreadId;
    readonly provider: ProviderKind;
    readonly runtimeInstanceId: string;
    readonly providerSessionId: string | null;
    readonly startedAt: string;
  }) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  /** Replace an exited/idle terminal runtime without exposing structured authority. */
  readonly beginTerminalRestart: (input: {
    readonly threadId: ThreadId;
    readonly runtimeInstanceId: string;
    readonly providerSessionId: string | null;
    readonly startedAt: string;
  }) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  readonly completeTerminalStart: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation: TerminalHostGeneration;
    readonly pid: number;
    readonly ownerIdentity: TerminalOwnerIdentity;
    readonly processGroupIdentity: TerminalProcessGroupIdentity | null;
  }) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  readonly beginTerminalStop: (
    threadId: ThreadId,
  ) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  readonly updateTerminal: (input: {
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly generation?: TerminalHostGeneration;
    readonly requireNoClaims?: boolean;
    readonly patch: Partial<
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
  }) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  readonly beginStructuredSwitch: (
    threadId: ThreadId,
  ) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
  readonly completeStructuredSwitch: (
    threadId: ThreadId,
    revision: number,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  readonly restoreStructured: (
    threadId: ThreadId,
    expectedTerminalRevision: number,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  readonly completeStructuredRestore: (
    threadId: ThreadId,
    revision: number,
  ) => Effect.Effect<StructuredAuthorityState, ExecutionAdapterAuthorityError>;
  readonly forgetThread: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ExecutionAdapterAuthorityError>;
  readonly assertTerminal: (
    threadId: ThreadId,
    revision: number,
    generation: TerminalHostGeneration,
  ) => Effect.Effect<TerminalAuthorityState, ExecutionAdapterAuthorityError>;
}

export class ExecutionAdapterAuthority extends ServiceMap.Service<
  ExecutionAdapterAuthority,
  ExecutionAdapterAuthorityShape
>()("agent-group/orchestration/Services/ExecutionAdapterAuthority") {}
