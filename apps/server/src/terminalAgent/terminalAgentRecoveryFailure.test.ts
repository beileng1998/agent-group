import { ThreadId } from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import { makeTerminalRecoveryFailureHandler } from "./terminalAgentRecoveryFailure";

const threadId = ThreadId.makeUnsafe("recovery-failure-thread");
const state = {
  adapter: "terminal",
  revision: 3,
  provider: "codex",
  status: "ready",
  runtimeInstanceId: "runtime-3",
  generation: "generation-3",
  pid: 42,
  ownerIdentity: {
    pid: 42,
    startTime: "Sat Jul 25 00:00:00 2026",
    commandFingerprint: "0".repeat(64),
  },
  processGroupIdentity: null,
  providerSessionId: null,
  activeTurnId: null,
  startedAt: "2026-07-25T00:00:00.000Z",
  exitCode: null,
  exitSignal: null,
  error: null,
} as const satisfies ExecutionAdapterState;

describe("terminal recovery failure state", () => {
  it("marks the unchanged terminal epoch as error", async () => {
    let current: ExecutionAdapterState = state;
    const update = vi.fn((input: { patch: Record<string, unknown> }) =>
      Effect.sync(() => {
        current = { ...current, ...input.patch } as ExecutionAdapterState;
        return current as Extract<ExecutionAdapterState, { adapter: "terminal" }>;
      }),
    );
    const coordinator = {
      getState: () => Effect.sync(() => current),
      streamChanges: Stream.empty,
      updateTerminalState: update,
    } as unknown as ExecutionAdapterCoordinatorShape;

    await Effect.runPromise(
      makeTerminalRecoveryFailureHandler(coordinator)(
        threadId,
        state,
        "Agent Terminal recovery timed out.",
      ),
    );

    expect(current).toMatchObject({
      status: "error",
      activeTurnId: null,
      error: "Agent Terminal recovery timed out.",
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it("does not overwrite a newer runtime epoch after a timeout", async () => {
    const coordinator = {
      getState: () =>
        Effect.succeed({
          ...state,
          revision: 4,
          runtimeInstanceId: "runtime-4",
        }),
      streamChanges: Stream.empty,
      updateTerminalState: vi.fn(),
    } as unknown as ExecutionAdapterCoordinatorShape;

    await Effect.runPromise(
      makeTerminalRecoveryFailureHandler(coordinator)(
        threadId,
        state,
        "late timeout",
      ),
    );

    expect(coordinator.updateTerminalState).not.toHaveBeenCalled();
  });
});
