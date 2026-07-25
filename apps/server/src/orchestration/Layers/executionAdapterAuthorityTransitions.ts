import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import {
  ExecutionAdapterAuthorityError,
  type ExecutionAdapterAuthorityState,
  type StructuredAuthorityState,
} from "../Services/ExecutionAdapterAuthority";
import type { ExecutionAdapterClaimRecord } from "./executionAdapterAuthorityClaims";
import {
  makeExecutionAdapterAuthorityError as authorityError,
  makeStructuredAuthorityState,
} from "./executionAdapterAuthorityState";

type MutateState = <A extends ExecutionAdapterAuthorityState>(
  threadId: ThreadId,
  mutate: (
    current: ExecutionAdapterAuthorityState,
    claims: ReadonlyMap<string, ExecutionAdapterClaimRecord>,
  ) => A | ExecutionAdapterAuthorityError,
) => Effect.Effect<A, ExecutionAdapterAuthorityError>;

const CLAIM_DRAIN_POLL = "10 millis";
const CLAIM_DRAIN_TIMEOUT = "10 seconds";

export function makeExecutionAdapterAuthorityTransitions(input: {
  readonly mutateState: MutateState;
  readonly claimCount: (threadId: ThreadId) => Effect.Effect<number>;
}) {
  const awaitClaimsDrained = (threadId: ThreadId) => {
    const poll = (): Effect.Effect<void> =>
      input.claimCount(threadId).pipe(
        Effect.flatMap((count) =>
          count === 0
            ? Effect.void
            : Effect.sleep(CLAIM_DRAIN_POLL).pipe(
                Effect.andThen(Effect.suspend(poll)),
              ),
        ),
      );
    return Effect.raceFirst(
      poll(),
      Effect.sleep(CLAIM_DRAIN_TIMEOUT).pipe(
        Effect.andThen(
          Effect.fail(
            authorityError(
              "structured-operation-active",
              `Thread ${threadId} still has an execution-adapter operation in flight.`,
            ),
          ),
        ),
      ),
    );
  };

  const beginStructuredStop = (threadId: ThreadId) =>
    input.mutateState(threadId, (current) => {
      if (current.adapter !== "structured") {
        return authorityError("not-structured", `Thread ${threadId} is not structured.`);
      }
      if (current.status !== "ready") {
        return authorityError(
          "transition-in-progress",
          `Thread ${threadId} cannot stop structured execution while ${current.status}.`,
        );
      }
      return { ...current, revision: current.revision + 1, status: "stopping" };
    });

  const completeStructuredStop = (threadId: ThreadId, revision: number) =>
    input.mutateState<StructuredAuthorityState>(threadId, (current) => {
      if (
        current.adapter !== "structured" ||
        current.status !== "stopping" ||
        current.revision !== revision
      ) {
        return authorityError(
          "transition-in-progress",
          `Thread ${threadId} is not completing structured stop ${revision}.`,
        );
      }
      return { ...current, status: "ready" };
    });

  const beginThreadDeletion = (threadId: ThreadId) =>
    input.mutateState(threadId, (current) => {
      if (current.adapter === "structured") {
        if (current.status === "deleting") return current;
        return { ...current, revision: current.revision + 1, status: "deleting" };
      }
      if (
        current.status === "stopped" &&
        current.pid === null &&
        current.ownerIdentity === null &&
        current.processGroupIdentity === null
      ) {
        return {
          ...makeStructuredAuthorityState(current.revision + 1),
          status: "deleting",
        };
      }
      if (current.status === "deleting") return current;
      if (current.activeTurnId !== null || current.status === "running") {
        return authorityError(
          "terminal-turn-active",
          `Thread ${threadId} still has a terminal turn in flight.`,
        );
      }
      return { ...current, status: "deleting" };
    });

  const completeTerminalDeletion = (threadId: ThreadId, revision: number) =>
    input.mutateState<StructuredAuthorityState>(threadId, (current) => {
      if (
        current.adapter !== "terminal" ||
        current.status !== "deleting" ||
        current.revision !== revision
      ) {
        return authorityError(
          "transition-in-progress",
          `Thread ${threadId} is not completing terminal deletion ${revision}.`,
        );
      }
      return { ...makeStructuredAuthorityState(current.revision + 1), status: "deleting" };
    });

  return {
    awaitClaimsDrained,
    beginStructuredStop,
    completeStructuredStop,
    beginThreadDeletion,
    completeTerminalDeletion,
  } as const;
}
