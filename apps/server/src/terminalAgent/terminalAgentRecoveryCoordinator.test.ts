import { DEFAULT_SERVER_SETTINGS, ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { TerminalAuthorityState } from "../orchestration/Services/ExecutionAdapterAuthority";
import { recoverTerminalAgentAuthorities } from "./terminalAgentRecoveryCoordinator";

function terminalState(index: number): TerminalAuthorityState {
  const pid = 10_000 + index;
  return {
    adapter: "terminal",
    revision: 1,
    provider: "codex",
    status: "ready",
    runtimeInstanceId: `runtime-${index}`,
    generation: `generation-${index}`,
    pid,
    ownerIdentity: {
      pid,
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
  };
}

describe("managed terminal recovery coordinator", () => {
  it("bounds per-Thread recovery, runs a small parallel batch, and records failures", async () => {
    const states = new Map(
      Array.from(
        { length: 6 },
        (_, index) => [ThreadId.makeUnsafe(`recovery-${index}`), terminalState(index)] as const,
      ),
    );
    let active = 0;
    let maximumActive = 0;
    const failed: string[] = [];

    await Effect.runPromise(
      recoverTerminalAgentAuthorities({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        listStates: Effect.succeed(states),
        withThread: (_threadId, operation) => operation,
        recoverTerminal: () =>
          Effect.sync(() => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                active -= 1;
              }),
            ),
          ),
        recoverStructured: () => Effect.void,
        onRecoveryFailure: (threadId, _state, reason) =>
          Effect.sync(() => {
            failed.push(`${threadId}:${reason}`);
          }),
        stateTimeoutMs: 10,
        totalTimeoutMs: 250,
      }),
    );

    expect(maximumActive).toBe(4);
    expect(active).toBe(0);
    expect(failed).toHaveLength(6);
    expect(failed.every((entry) => entry.includes("timed out"))).toBe(true);
  });

  it("returns at the total recovery deadline even when queued work cannot settle", async () => {
    const states = new Map(
      Array.from(
        { length: 20 },
        (_, index) => [ThreadId.makeUnsafe(`deadline-${index}`), terminalState(index)] as const,
      ),
    );
    const startedAt = Date.now();
    const failed: string[] = [];

    await Effect.runPromise(
      recoverTerminalAgentAuthorities({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        listStates: Effect.succeed(states),
        withThread: (_threadId, operation) => operation,
        recoverTerminal: () => Effect.never,
        recoverStructured: () => Effect.void,
        onRecoveryFailure: (_threadId, _state, reason) =>
          Effect.sync(() => {
            failed.push(reason);
          }),
        stateTimeoutMs: 1_000,
        totalTimeoutMs: 20,
      }),
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(failed).toHaveLength(20);
    expect(failed.every((reason) => reason.includes("startup time limit"))).toBe(true);
  });
});
