import type { TerminalAgentEvent, TerminalAgentProvider, ThreadId } from "@agent-group/contracts";
import { Effect, Queue, Stream } from "effect";

import type {
  ExecutionAdapterChange,
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import { terminalAgentRuntimeState } from "./terminalAgentRuntimeState";
import { TerminalAgentServiceError } from "./Services/TerminalAgentService";

const STREAM_BUFFER_EVENTS = 256;
const ATTACH_BUFFER_BYTES = 4 * 1024 * 1024;

interface SubscriptionDependencies {
  readonly threadId: ThreadId;
  readonly provider: TerminalAgentProvider;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly runtimeForThread: () => TerminalAgentRuntimeRecord | undefined;
  readonly includeOutput: boolean;
}

type TerminalState = Extract<ExecutionAdapterState, { adapter: "terminal" }>;
type AttachReadyTerminalState = TerminalState & { readonly generation: string };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Agent Terminal attach failed.";
}

function isSnapshotTooLarge(cause: unknown, seen = new Set<unknown>()): boolean {
  if (typeof cause !== "object" || cause === null || seen.has(cause)) return false;
  seen.add(cause);
  const candidate = cause as { readonly reason?: unknown; readonly cause?: unknown };
  return candidate.reason === "snapshot-too-large" || isSnapshotTooLarge(candidate.cause, seen);
}

function sameRuntimeEpoch(left: ExecutionAdapterState, right: ExecutionAdapterState): boolean {
  return (
    left.adapter === right.adapter &&
    left.revision === right.revision &&
    (left.adapter === "structured" ||
      (right.adapter === "terminal" && left.generation === right.generation))
  );
}

function hasGeneration(state: TerminalState): state is AttachReadyTerminalState {
  return state.generation !== null;
}

function canAttachTerminal(state: AttachReadyTerminalState): boolean {
  return (
    state.status === "checking" ||
    state.status === "ready" ||
    state.status === "running" ||
    state.status === "attention" ||
    state.status === "context-blocked" ||
    state.status === "error"
  );
}

export function makeTerminalAgentSubscription(
  dependencies: SubscriptionDependencies,
): Stream.Stream<TerminalAgentEvent, TerminalAgentServiceError> {
  return Stream.callback<TerminalAgentEvent, TerminalAgentServiceError>(
    (queue) =>
      Effect.gen(function* () {
        let unsubscribeClient: (() => void) | null = null;
        let attachedEpoch: { revision: number; generation: string } | null = null;
        let blockedAttachEpoch: { revision: number; generation: string } | null = null;
        let callbackOfferTail = Promise.resolve();
        let pendingCallbackOffers = 0;
        let pendingCallbackBytes = 0;
        let callbackOverflowed = false;
        let activeCallbackToken: symbol | null = null;
        const backpressureError = () =>
          new TerminalAgentServiceError({
            reason: "stale-runtime",
            message: "Terminal output consumer fell behind; reconnect for a fresh snapshot.",
          });
        const offer = (event: TerminalAgentEvent) =>
          Queue.offer(queue, event).pipe(
            Effect.flatMap((accepted) =>
              accepted ? Effect.void : Queue.fail(queue, backpressureError()).pipe(Effect.asVoid),
            ),
          );
        const offerFromCallback = (event: TerminalAgentEvent, token: symbol) => {
          if (callbackOverflowed) return;
          const eventBytes = event.type === "output" ? Buffer.byteLength(event.data) : 0;
          pendingCallbackOffers += 1;
          pendingCallbackBytes += eventBytes;
          if (
            pendingCallbackOffers > STREAM_BUFFER_EVENTS ||
            pendingCallbackBytes > ATTACH_BUFFER_BYTES
          ) {
            pendingCallbackOffers -= 1;
            pendingCallbackBytes -= eventBytes;
            callbackOverflowed = true;
            Effect.runFork(Queue.fail(queue, backpressureError()));
            return;
          }
          callbackOfferTail = callbackOfferTail
            .then(() =>
              activeCallbackToken === token ? Effect.runPromise(offer(event)) : undefined,
            )
            .catch(() => undefined)
            .finally(() => {
              pendingCallbackOffers -= 1;
              pendingCallbackBytes -= eventBytes;
            });
        };
        const stateEvent = (state: ExecutionAdapterState): TerminalAgentEvent => ({
          type: "state",
          state: terminalAgentRuntimeState({
            threadId: dependencies.threadId,
            provider: dependencies.provider,
            authority: state,
            runtime: dependencies.runtimeForThread(),
          }),
        });

        const detach = () => {
          unsubscribeClient?.();
          unsubscribeClient = null;
          attachedEpoch = null;
          activeCallbackToken = null;
        };
        yield* Effect.addFinalizer(() => Effect.sync(detach));

        const attach = (state: AttachReadyTerminalState) =>
          Effect.gen(function* () {
            detach();
            const buffered: TerminalAgentEvent[] = [];
            let bufferedBytes = 0;
            let attachOverflowed = false;
            let live = false;
            const callbackToken = Symbol("terminal-agent-attach");
            const bufferUntilAttached = (event: TerminalAgentEvent) => {
              if (attachOverflowed) return;
              const eventBytes = event.type === "output" ? Buffer.byteLength(event.data) : 0;
              if (
                buffered.length >= STREAM_BUFFER_EVENTS ||
                bufferedBytes + eventBytes > ATTACH_BUFFER_BYTES
              ) {
                attachOverflowed = true;
                return;
              }
              bufferedBytes += eventBytes;
              buffered.push(event);
            };
            const attached = yield* dependencies.coordinator
              .attachClient({
                threadId: dependencies.threadId,
                revision: state.revision,
                generation: state.generation,
                onOutput: (output) => {
                  const event: TerminalAgentEvent = {
                    type: "output",
                    threadId: dependencies.threadId,
                    revision: state.revision,
                    generation: output.generation,
                    seq: output.seq,
                    data: output.data,
                  };
                  if (live) offerFromCallback(event, callbackToken);
                  else bufferUntilAttached(event);
                },
                onExit: (exit) => {
                  const event: TerminalAgentEvent = {
                    type: "exited",
                    threadId: dependencies.threadId,
                    revision: state.revision,
                    generation: exit.generation,
                    exit: {
                      code: exit.exitCode,
                      signal: exit.signal ?? null,
                    },
                  };
                  if (live) offerFromCallback(event, callbackToken);
                  else bufferUntilAttached(event);
                },
              })
              .pipe(Effect.result);
            if (attached._tag === "Success") {
              // Own the cleanup immediately so interruption during reconciliation cannot leak it.
              unsubscribeClient = attached.success.unsubscribe;
            }
            const latest = yield* dependencies.coordinator.getState(dependencies.threadId);
            if (attachOverflowed) {
              detach();
              yield* Queue.fail(queue, backpressureError());
              return null;
            }
            if (!sameRuntimeEpoch(state, latest)) {
              detach();
              return latest;
            }
            if (attached._tag === "Failure") {
              if (isSnapshotTooLarge(attached.failure)) {
                blockedAttachEpoch = {
                  revision: state.revision,
                  generation: state.generation,
                };
              }
              const marked = yield* dependencies.coordinator
                .updateTerminalState({
                  threadId: dependencies.threadId,
                  revision: state.revision,
                  generation: state.generation,
                  patch: {
                    status: "error",
                    error: errorMessage(attached.failure),
                  },
                })
                .pipe(Effect.result);
              yield* offer(
                stateEvent(
                  marked._tag === "Success"
                    ? marked.success
                    : yield* dependencies.coordinator.getState(dependencies.threadId),
                ),
              );
              return null;
            }
            const snapshot = attached.success.attached.snapshot;
            if (snapshot === null) {
              detach();
              const marked = yield* dependencies.coordinator
                .updateTerminalState({
                  threadId: dependencies.threadId,
                  revision: state.revision,
                  generation: state.generation,
                  patch: {
                    status: "error",
                    error: "Agent Terminal snapshot is unavailable.",
                  },
                })
                .pipe(Effect.result);
              yield* offer(
                stateEvent(
                  marked._tag === "Success"
                    ? marked.success
                    : yield* dependencies.coordinator.getState(dependencies.threadId),
                ),
              );
              return null;
            }
            attachedEpoch = {
              revision: state.revision,
              generation: state.generation,
            };
            yield* offer({
              type: "attached",
              threadId: dependencies.threadId,
              revision: state.revision,
              generation: state.generation,
              snapshot: {
                snapshotAnsi: snapshot.snapshotAnsi,
                scrollbackAnsi: snapshot.scrollbackAnsi,
                rehydrateSequences: snapshot.rehydrateSequences,
                ...(snapshot.pendingEscapeTailAnsi !== undefined
                  ? { pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi }
                  : {}),
                cols: snapshot.cols,
                rows: snapshot.rows,
                outputSequence: snapshot.outputSequence,
              },
            });
            if (attachOverflowed) {
              detach();
              yield* Queue.fail(queue, backpressureError());
              return null;
            }
            let index = 0;
            while (index < buffered.length) {
              const event = buffered[index++]!;
              if (event.type !== "output" || event.seq > snapshot.outputSequence) {
                yield* offer(event);
                if (attachOverflowed) {
                  detach();
                  yield* Queue.fail(queue, backpressureError());
                  return null;
                }
              }
            }
            activeCallbackToken = callbackToken;
            live = true;
            yield* offer(stateEvent(latest));
            return null;
          });

        const reconcile = (initial: ExecutionAdapterState) =>
          Effect.gen(function* () {
            let state = initial;
            while (true) {
              if (state.adapter === "structured") {
                detach();
                yield* offer(stateEvent(state));
                return;
              }
              if (!hasGeneration(state)) {
                detach();
                yield* offer(stateEvent(state));
                return;
              }
              if (
                blockedAttachEpoch &&
                (blockedAttachEpoch.revision !== state.revision ||
                  blockedAttachEpoch.generation !== state.generation)
              ) {
                blockedAttachEpoch = null;
              }
              if (
                blockedAttachEpoch?.revision === state.revision &&
                blockedAttachEpoch.generation === state.generation
              ) {
                detach();
                yield* offer(stateEvent(state));
                return;
              }
              if (!dependencies.includeOutput || !canAttachTerminal(state)) {
                detach();
                yield* offer(stateEvent(state));
                return;
              }
              if (
                attachedEpoch?.revision === state.revision &&
                attachedEpoch.generation === state.generation
              ) {
                yield* offer(stateEvent(state));
                return;
              }
              const latest = yield* attach(state);
              if (latest === null) return;
              state = latest;
            }
          });

        const pullChanges = yield* dependencies.coordinator.streamChanges.pipe(
          Stream.filter(
            (change: ExecutionAdapterChange) => change.threadId === dependencies.threadId,
          ),
          Stream.toPull,
        );
        const changeWakeups = yield* Queue.sliding<void>(1);
        yield* Effect.forkScoped(
          Effect.forever(
            pullChanges.pipe(Effect.flatMap(() => Queue.offer(changeWakeups, undefined))),
          ).pipe(Effect.catch(() => Effect.void)),
        );
        // Start the first pull and let it acquire the upstream subscription before reading state.
        yield* Effect.yieldNow;
        yield* reconcile(yield* dependencies.coordinator.getState(dependencies.threadId));
        yield* Effect.forkScoped(
          Effect.forever(
            Queue.take(changeWakeups).pipe(
              Effect.andThen(dependencies.coordinator.getState(dependencies.threadId)),
              Effect.flatMap(reconcile),
            ),
          ).pipe(Effect.catch(() => Effect.void)),
        );
      }),
    { bufferSize: STREAM_BUFFER_EVENTS, strategy: "dropping" },
  );
}
