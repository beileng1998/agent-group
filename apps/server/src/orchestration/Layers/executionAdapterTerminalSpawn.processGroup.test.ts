import { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";
import type { ExecutionAdapterAuthorityState } from "../Services/ExecutionAdapterAuthority";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import { spawnTerminalRuntime } from "./executionAdapterTerminalSpawn";

const threadId = ThreadId.makeUnsafe("terminal-spawn-process-group");
const ownerIdentity = {
  pid: 42,
  startTime: "Sat Jul 25 00:00:00 2026",
  commandFingerprint: "a".repeat(64),
};
const processGroupIdentity = {
  pgid: 42,
  leaderIdentity: ownerIdentity,
};

describe("terminal spawn process-group durability", () => {
  it("persists verified group ownership before publishing ready", async () => {
    const persisted: ExecutionAdapterAuthorityState[] = [];
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: (states) =>
          Effect.sync(() => {
            const state = states.get(threadId);
            if (state !== undefined) persisted.push(state);
          }),
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-group",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const captureOwnerIdentity = vi.fn(() => {
      throw new Error("the durable group leader should be reused");
    });
    const terminalHost = {
      createOrAttach: () =>
        Effect.succeed({
          isNew: true,
          generation: "generation-group",
          pid: 42,
          processGroupIdentity,
          snapshot: null,
        }),
      isAlive: () => Effect.succeed(true),
    } as unknown as TerminalHostServiceShape;

    await Effect.runPromise(
      spawnTerminalRuntime({
        terminalHost,
        authority,
        threadId,
        revision: starting.revision,
        runtimeInstanceId: "runtime-group",
        spawn: {
          command: "/trusted/codex",
          cwd: "/workspace",
          cols: 80,
          rows: 24,
        },
        sessionId: "agent:terminal-spawn-process-group",
        captureOwnerIdentity,
        registerExit: () => Effect.void,
      }),
    );

    const durableStarting = persisted.find(
      (state) => state.adapter === "terminal" && state.status === "starting" && state.pid === 42,
    );
    expect(durableStarting).toMatchObject({
      ownerIdentity,
      processGroupIdentity,
    });
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "ready",
      ownerIdentity,
      processGroupIdentity,
    });
    expect(captureOwnerIdentity).not.toHaveBeenCalled();
  });
});
