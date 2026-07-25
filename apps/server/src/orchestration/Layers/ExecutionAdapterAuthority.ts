// FILE: ExecutionAdapterAuthority.ts
// Purpose: In-memory atomic authority with pluggable durable snapshots.
// Layer: Server orchestration service implementation

import type { ThreadId } from "@agent-group/contracts";
import { Effect, PubSub, Ref, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import {
  ExecutionAdapterAuthority,
  ExecutionAdapterAuthorityError,
  type ExecutionAdapterAuthorityChange,
  type ExecutionAdapterAuthorityShape,
  type ExecutionAdapterAuthorityState,
  type StructuredAdmissionClaim,
} from "../Services/ExecutionAdapterAuthority";
import {
  type ExecutionAdapterClaimRecord,
  pruneExecutionAdapterClaims,
} from "./executionAdapterAuthorityClaims";
import {
  type ExecutionAdapterAuthorityRuntimeState,
  completeTerminalStartState,
  makeExecutionAdapterAuthorityError as authorityError,
  makeStructuredAuthorityState as structuredState,
  terminalAuthorityAcceptsOperations,
  terminalStatusUpdateAllowed,
} from "./executionAdapterAuthorityState";
import { makeTerminalAuthorityAssertion } from "./executionAdapterAuthorityAssertion";
import { makeExecutionAdapterAuthorityForget } from "./executionAdapterAuthorityForget";
import { makeExecutionAdapterAuthorityTransitions } from "./executionAdapterAuthorityTransitions";

export function makeExecutionAdapterAuthority(input: {
  readonly initialStates?: ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>;
  readonly persist: (
    states: ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>,
  ) => Effect.Effect<void, unknown>;
  readonly now: () => Date;
  readonly authorityUnavailableReason?: string;
}): Effect.Effect<ExecutionAdapterAuthorityShape> {
  return Effect.gen(function* () {
    const runtime = yield* Ref.make<ExecutionAdapterAuthorityRuntimeState>({
      states: new Map(input.initialStates),
      claims: new Map(),
    });
    const changes = yield* PubSub.unbounded<ExecutionAdapterAuthorityChange>();
    const transactionLock = yield* Semaphore.make(1);

    const unavailableError = () =>
      authorityError(
        "authority-unavailable",
        input.authorityUnavailableReason ??
          "Execution adapter authority is unavailable.",
      );
    const getState = (threadId: ThreadId) =>
      input.authorityUnavailableReason
        ? Effect.die(unavailableError())
        : Ref.get(runtime).pipe(
            Effect.map(
              (current) => current.states.get(threadId) ?? structuredState(),
            ),
          );
    const listStates = Ref.get(runtime).pipe(
      Effect.map((current) => new Map(current.states) as ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>),
    );
    const releaseClaim = (threadId: ThreadId, claimId: string) =>
      transactionLock.withPermits(1)(
        Ref.update(runtime, (current) => {
          const byId = current.claims.get(threadId);
          if (!byId?.has(claimId)) return current;
          const nextById = new Map(byId);
          const record = nextById.get(claimId)!;
          if (record.holders > 1) {
            nextById.set(claimId, {
              ...record,
              holders: record.holders - 1,
            });
          } else {
            nextById.delete(claimId);
          }
          const claims = new Map(current.claims);
          if (nextById.size === 0) claims.delete(threadId);
          else claims.set(threadId, nextById);
          return { ...current, claims };
        }),
      );

    const addClaim = (
      threadId: ThreadId,
      claimId: string,
      turnStart: boolean,
      requireExisting: boolean,
    ): Effect.Effect<StructuredAdmissionClaim, ExecutionAdapterAuthorityError> =>
      input.authorityUnavailableReason
        ? Effect.fail(unavailableError())
        : transactionLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(runtime);
          const now = input.now().getTime();
          const claims = pruneExecutionAdapterClaims(current.claims, now);
          const state = current.states.get(threadId) ?? structuredState();
          if (state.adapter !== "structured" || state.status !== "ready") {
            return yield* Effect.fail(
              authorityError(
                state.adapter === "structured" ? "transition-in-progress" : "not-structured",
                state.adapter === "structured"
                  ? `Thread ${threadId} is changing execution-adapter state.`
                  : `Thread ${threadId} is owned by the terminal execution adapter.`,
              ),
            );
          }
          const existing = claims.get(threadId)?.get(claimId);
          if (requireExisting && (!existing || !existing.turnStart)) {
            return yield* Effect.fail(
              authorityError(
                "claim-missing",
                `Structured start claim ${claimId} is not reserved for thread ${threadId}.`,
              ),
            );
          }
          const byId = new Map(claims.get(threadId));
          byId.set(claimId, existing
            ? requireExisting || !turnStart
              ? {
                  ...existing,
                  createdAt: now,
                  holders: existing.holders + 1,
                  leased: true,
                }
              : existing
            : {
                adapter: "structured",
                createdAt: now,
                holders: turnStart ? 0 : 1,
                leased: !turnStart,
                turnStart,
              });
          yield* Ref.set(runtime, {
            ...current,
            claims: new Map(claims).set(threadId, byId),
          });
          return {
            threadId,
            claimId,
            release: releaseClaim(threadId, claimId),
          } satisfies StructuredAdmissionClaim;
        }),
      );

    const acquireTerminal: ExecutionAdapterAuthorityShape["acquireTerminal"] = (
      threadId,
      revision,
      generation,
      claimId,
    ) =>
      input.authorityUnavailableReason
        ? Effect.fail(unavailableError())
        : transactionLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(runtime);
          const now = input.now().getTime();
          const claims = pruneExecutionAdapterClaims(current.claims, now);
          const state = current.states.get(threadId) ?? structuredState();
          if (state.adapter !== "terminal") {
            return yield* Effect.fail(
              authorityError("not-terminal", `Thread ${threadId} is not terminal.`),
            );
          }
          if (state.revision !== revision) {
            return yield* Effect.fail(
              authorityError("stale-revision", `Terminal revision ${revision} is stale.`),
            );
          }
          if (state.generation !== generation) {
            return yield* Effect.fail(
              authorityError("stale-generation", "Terminal generation is stale."),
            );
          }
          if (!terminalAuthorityAcceptsOperations(state.status)) {
            return yield* Effect.fail(
              authorityError(
                "transition-in-progress",
                `Terminal revision ${revision} does not accept operations while ${state.status}.`,
              ),
            );
          }
          const byId = new Map(claims.get(threadId));
          const existing = byId.get(claimId);
          byId.set(
            claimId,
            existing
              ? {
                  ...existing,
                  createdAt: now,
                  holders: existing.holders + 1,
                }
              : {
                  adapter: "terminal",
                  createdAt: now,
                  holders: 1,
                  leased: true,
                  turnStart: false,
                },
          );
          yield* Ref.set(runtime, {
            ...current,
            claims: new Map(claims).set(threadId, byId),
          });
          return {
            threadId,
            claimId,
            revision,
            generation,
            release: releaseClaim(threadId, claimId),
          };
        }),
      );

    const mutateState = <A extends ExecutionAdapterAuthorityState>(
      threadId: ThreadId,
      mutate: (
        current: ExecutionAdapterAuthorityState,
        claims: ReadonlyMap<string, ExecutionAdapterClaimRecord>,
      ) => A | ExecutionAdapterAuthorityError,
    ): Effect.Effect<A, ExecutionAdapterAuthorityError> =>
      input.authorityUnavailableReason
        ? Effect.fail(unavailableError())
        : transactionLock.withPermits(1)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const current = yield* Ref.get(runtime);
            const claims = pruneExecutionAdapterClaims(
              current.claims,
              input.now().getTime(),
            );
            const state = current.states.get(threadId) ?? structuredState();
            const result = mutate(state, claims.get(threadId) ?? new Map());
            if (result instanceof ExecutionAdapterAuthorityError) {
              return yield* Effect.fail(result);
            }
            const states = new Map(current.states).set(threadId, result);
            yield* input.persist(states).pipe(
              Effect.mapError((cause) =>
                authorityError(
                  "persistence-failed",
                  `Execution adapter authority could not be persisted: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
              ),
            );
            yield* Ref.set(runtime, { states, claims });
            yield* PubSub.publish(changes, {
              threadId,
              state: result,
              changedAt: input.now().toISOString(),
            });
            return result;
          }),
        ),
      );

    const reserveStructuredStart: ExecutionAdapterAuthorityShape["reserveStructuredStart"] = (
      threadId,
      claimId,
    ) => addClaim(threadId, claimId, true, false).pipe(Effect.asVoid);

    const structuredTransitions = makeExecutionAdapterAuthorityTransitions({
      mutateState,
      claimCount: (threadId) =>
        transactionLock.withPermits(1)(
          Ref.get(runtime).pipe(
            Effect.map((current) => {
              const claims = pruneExecutionAdapterClaims(
                current.claims,
                input.now().getTime(),
              );
              return claims.get(threadId)?.size ?? 0;
            }),
          ),
        ),
    });

    const beginTerminalSwitch: ExecutionAdapterAuthorityShape["beginTerminalSwitch"] = (next) =>
      mutateState(next.threadId, (current, claims) => {
        if (current.adapter !== "structured" || current.status !== "ready") {
          return authorityError(
            current.adapter === "structured" ? "transition-in-progress" : "not-structured",
            `Thread ${next.threadId} cannot switch execution adapters right now.`,
          );
        }
        if (claims.size > 0) {
          return authorityError(
            "structured-operation-active",
            `Thread ${next.threadId} has a structured operation in flight.`,
          );
        }
        return {
          adapter: "terminal",
          revision: current.revision + 1,
          provider: next.provider,
          status: "starting",
          runtimeInstanceId: next.runtimeInstanceId,
          generation: null,
          pid: null,
          ownerIdentity: null,
          processGroupIdentity: null,
          providerSessionId: next.providerSessionId,
          activeTurnId: null,
          startedAt: next.startedAt,
          exitCode: null,
          exitSignal: null,
          error: null,
        };
      });

    const beginTerminalRestart: ExecutionAdapterAuthorityShape["beginTerminalRestart"] = (next) =>
      mutateState(next.threadId, (current, claims) => {
        if (current.adapter !== "terminal") {
          return authorityError("not-terminal", `Thread ${next.threadId} is not terminal.`);
        }
        if (claims.size > 0) {
          return authorityError(
            "structured-operation-active",
            `Thread ${next.threadId} has a terminal operation in flight.`,
          );
        }
        if (current.activeTurnId !== null || current.status === "running") {
          return authorityError(
            "terminal-turn-active",
            `Thread ${next.threadId} has a terminal turn in flight.`,
          );
        }
        if (
          current.status === "starting" ||
          current.status === "checking"
        ) {
          return authorityError(
            "transition-in-progress",
            `Thread ${next.threadId} is already changing terminal runtimes.`,
          );
        }
        return {
          ...current,
          revision: current.revision + 1,
          status: "starting",
          runtimeInstanceId: next.runtimeInstanceId,
          generation: null,
          pid: null,
          ownerIdentity: null,
          processGroupIdentity: null,
          providerSessionId: next.providerSessionId,
          activeTurnId: null,
          startedAt: next.startedAt,
          exitCode: null,
          exitSignal: null,
          error: null,
        };
      });

    const beginTerminalStop: ExecutionAdapterAuthorityShape["beginTerminalStop"] = (threadId) =>
      mutateState(threadId, (current, claims) => {
        if (current.adapter !== "terminal") {
          return authorityError("not-terminal", `Thread ${threadId} is not terminal.`);
        }
        if (claims.size > 0) {
          return authorityError(
            "structured-operation-active",
            `Thread ${threadId} has a terminal operation in flight.`,
          );
        }
        if (current.activeTurnId !== null || current.status === "running") {
          return authorityError(
            "terminal-turn-active",
            `Thread ${threadId} has a terminal turn in flight.`,
          );
        }
        if (current.status === "stopping") return current;
        return { ...current, status: "stopping" };
      });

    const completeTerminalStart: ExecutionAdapterAuthorityShape["completeTerminalStart"] = (next) =>
      mutateState(next.threadId, (current) =>
        completeTerminalStartState(current, next),
      );

    const updateTerminal: ExecutionAdapterAuthorityShape["updateTerminal"] = (next) =>
      mutateState(next.threadId, (current, claims) => {
        if (current.adapter !== "terminal") {
          return authorityError("not-terminal", `Thread ${next.threadId} is not terminal.`);
        }
        if (current.revision !== next.revision) {
          return authorityError("stale-revision", `Terminal revision ${next.revision} is stale.`);
        }
        if (next.generation !== undefined && current.generation !== next.generation) {
          return authorityError("stale-generation", `Terminal generation is stale.`);
        }
        if (next.requireNoClaims && claims.size > 0) {
          return authorityError(
            "structured-operation-active",
            `Thread ${next.threadId} has a terminal operation in flight.`,
          );
        }
        if (
          next.patch.status !== undefined &&
          !terminalStatusUpdateAllowed(current.status, next.patch.status)
        ) {
          return authorityError(
            "transition-in-progress",
            `Terminal revision ${next.revision} cannot leave ${current.status} without restarting.`,
          );
        }
        return { ...current, ...next.patch };
      });

    const beginStructuredSwitch: ExecutionAdapterAuthorityShape["beginStructuredSwitch"] = (
      threadId,
    ) =>
      mutateState(threadId, (current, claims) => {
        if (current.adapter !== "terminal") {
          return authorityError("not-terminal", `Thread ${threadId} is already structured.`);
        }
        if (claims.size > 0) {
          return authorityError(
            "structured-operation-active",
            `Thread ${threadId} has a terminal operation in flight.`,
          );
        }
        if (current.activeTurnId !== null || current.status === "running") {
          return authorityError(
            "terminal-turn-active",
            `Thread ${threadId} has a terminal turn in flight.`,
          );
        }
        return { ...current, status: "stopping" };
      });

    const toStructured = (threadId: ThreadId, revision: number) =>
      mutateState(threadId, (current) => {
        if (current.adapter !== "terminal") {
          return authorityError("not-terminal", `Thread ${threadId} is not terminal.`);
        }
        if (current.revision !== revision) {
          return authorityError("stale-revision", `Terminal revision ${revision} is stale.`);
        }
        return { ...structuredState(current.revision + 1), status: "restoring" };
      });

    const assertTerminal = makeTerminalAuthorityAssertion(getState);

    const forgetThread = makeExecutionAdapterAuthorityForget({
      runtime,
      transactionLock,
      persist: input.persist,
      now: input.now,
      unavailableError,
      unavailable: input.authorityUnavailableReason !== undefined,
    });

    return {
      safetyModeReason: input.authorityUnavailableReason ?? null,
      getState,
      listStates,
      streamChanges: Stream.fromPubSub(changes),
      acquireStructured: (threadId, claimId) => addClaim(threadId, claimId, false, false),
      reserveStructuredStart,
      claimStructuredStart: (threadId, claimId) => addClaim(threadId, claimId, true, true),
      releaseStructured: releaseClaim,
      acquireTerminal,
      ...structuredTransitions,
      beginTerminalSwitch,
      beginTerminalRestart,
      completeTerminalStart,
      beginTerminalStop,
      updateTerminal,
      beginStructuredSwitch,
      completeStructuredSwitch: toStructured,
      restoreStructured: toStructured,
      completeStructuredRestore: (threadId, revision) =>
        mutateState(threadId, (current) => {
          if (current.adapter !== "structured" || current.status !== "restoring") {
            return authorityError(
              "transition-in-progress",
              `Thread ${threadId} is not restoring its structured runtime.`,
            );
          }
          if (current.revision !== revision) {
            return authorityError("stale-revision", `Structured revision ${revision} is stale.`);
          }
          return { ...current, status: "ready" };
        }),
      assertTerminal,
      forgetThread,
    } satisfies ExecutionAdapterAuthorityShape;
  });
}
