import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@agent-group/contracts";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import type { ExecutionAdapterAuthorityError } from "../Services/ExecutionAdapterAuthority";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import {
  loadExecutionAdapterAuthority,
  readExecutionAdapterAuthority,
  writeExecutionAdapterAuthority,
} from "./executionAdapterAuthorityPersistence";

const threadId = ThreadId.makeUnsafe("thread-authority");

function failureReason(exit: Exit.Exit<unknown, unknown>): string | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  const failure = Cause.findErrorOption(exit.cause);
  if (failure._tag === "Some") {
    return (failure.value as ExecutionAdapterAuthorityError).reason;
  }
  const defect = Cause.findDefect(exit.cause);
  return Result.isSuccess(defect) && defect.success
    ? (defect.success as ExecutionAdapterAuthorityError).reason
    : undefined;
}

async function makeAuthority() {
  return Effect.runPromise(
    makeExecutionAdapterAuthority({
      persist: () => Effect.void,
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    }),
  );
}

describe("ExecutionAdapterAuthority", () => {
  it("blocks terminal switching while a structured operation owns admission", async () => {
    const authority = await makeAuthority();
    const claim = await Effect.runPromise(authority.acquireStructured(threadId, "meta:1"));

    const blocked = await Effect.runPromiseExit(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    expect(failureReason(blocked)).toBe("structured-operation-active");

    await Effect.runPromise(claim.release);
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    expect(starting).toMatchObject({ adapter: "terminal", status: "starting", revision: 1 });
  });

  it("hands a persisted turn-start reservation to the reactor exactly once", async () => {
    const authority = await makeAuthority();
    await Effect.runPromise(authority.reserveStructuredStart(threadId, "command:turn-1"));
    const claim = await Effect.runPromise(
      authority.claimStructuredStart(threadId, "command:turn-1"),
    );
    await Effect.runPromise(claim.release);

    const missing = await Effect.runPromiseExit(
      authority.claimStructuredStart(threadId, "command:turn-1"),
    );
    expect(failureReason(missing)).toBe("claim-missing");
  });

  it("rejects stale revisions and generations and keeps natural exit terminal-owned", async () => {
    const authority = await makeAuthority();
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const ready = await Effect.runPromise(
      authority.completeTerminalStart({
        threadId,
        revision: starting.revision,
        generation: "generation-1",
        pid: 42,
        ownerIdentity: {
          pid: 42,
          startTime: "2026-07-25T00:00:00.000Z",
          commandFingerprint: "0".repeat(64),
        },
        processGroupIdentity: null,
      }),
    );

    const stale = await Effect.runPromiseExit(
      authority.assertTerminal(threadId, ready.revision - 1, "generation-1"),
    );
    expect(failureReason(stale)).toBe("stale-revision");
    const exited = await Effect.runPromise(
      authority.updateTerminal({
        threadId,
        revision: ready.revision,
        generation: "generation-1",
        patch: { status: "exited", exitCode: 0, exitSignal: null },
      }),
    );
    expect(exited).toMatchObject({
      adapter: "terminal",
      status: "exited",
      generation: "generation-1",
    });
    const resurrected = await Effect.runPromiseExit(
      authority.updateTerminal({
        threadId,
        revision: ready.revision,
        generation: "generation-1",
        patch: { status: "ready", error: null },
      }),
    );
    expect(failureReason(resurrected)).toBe("transition-in-progress");
    expect((await Effect.runPromise(authority.getState(threadId))).adapter).toBe("terminal");
  });

  it("does not publish or commit authority when durable persistence fails", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.fail(new Error("disk unavailable")),
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );

    const failed = await Effect.runPromiseExit(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );

    expect(failureReason(failed)).toBe("persistence-failed");
    expect(await Effect.runPromise(authority.getState(threadId))).toEqual({
      adapter: "structured",
      revision: 0,
      status: "ready",
    });
  });

  it("does not persist an identical terminal state behind an active claim", async () => {
    let persistCount = 0;
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () =>
          Effect.sync(() => {
            persistCount += 1;
          }),
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-no-op",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const ready = await Effect.runPromise(
      authority.completeTerminalStart({
        threadId,
        revision: starting.revision,
        generation: "generation-no-op",
        pid: 42,
        ownerIdentity: {
          pid: 42,
          startTime: "2026-07-25T00:00:00.000Z",
          commandFingerprint: "0".repeat(64),
        },
        processGroupIdentity: null,
      }),
    );
    const claim = await Effect.runPromise(
      authority.acquireTerminal(threadId, ready.revision, "generation-no-op", "terminal:no-op"),
    );
    const exitedPatch = {
      status: "exited" as const,
      activeTurnId: null,
      exitCode: 1,
      exitSignal: null,
    };
    await Effect.runPromise(
      authority.updateTerminal({
        threadId,
        revision: ready.revision,
        generation: "generation-no-op",
        patch: exitedPatch,
      }),
    );
    const beforeNoOp = persistCount;
    await Effect.runPromise(
      authority.updateTerminal({
        threadId,
        revision: ready.revision,
        generation: "generation-no-op",
        requireNoClaims: true,
        patch: exitedPatch,
      }),
    );

    expect(persistCount).toBe(beforeNoOp);
    await Effect.runPromise(claim.release);
  });

  it("accepts a later transition after a transient persistence failure", async () => {
    let attempts = 0;
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1
              ? Effect.fail(new Error("transient disk failure"))
              : Effect.void;
          }),
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );
    const request = {
      threadId,
      provider: "codex" as const,
      runtimeInstanceId: "runtime-1",
      providerSessionId: null,
      startedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(
      failureReason(
        await Effect.runPromiseExit(authority.beginTerminalSwitch(request)),
      ),
    ).toBe("persistence-failed");
    await expect(
      Effect.runPromise(authority.beginTerminalSwitch(request)),
    ).resolves.toMatchObject({ adapter: "terminal", revision: 1 });
    expect(attempts).toBe(2);
  });

  it("forgets durable authority only after a deletion tombstone is established", async () => {
    const authority = await makeAuthority();
    const terminal = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-delete",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const restoring = await Effect.runPromise(
      authority.completeStructuredSwitch(threadId, terminal.revision),
    );
    await Effect.runPromise(
      authority.completeStructuredRestore(threadId, restoring.revision),
    );
    await Effect.runPromise(authority.beginThreadDeletion(threadId));

    await Effect.runPromise(authority.forgetThread(threadId));

    expect((await Effect.runPromise(authority.listStates)).has(threadId)).toBe(false);
  });

  it("refuses to forget ready authority or a tombstone with active leases", async () => {
    const authority = await makeAuthority();
    expect(
      failureReason(await Effect.runPromiseExit(authority.forgetThread(threadId))),
    ).toBe("transition-in-progress");
    const claim = await Effect.runPromise(
      authority.acquireStructured(threadId, "structured:delete"),
    );
    await Effect.runPromise(authority.beginThreadDeletion(threadId));
    expect(
      failureReason(await Effect.runPromiseExit(authority.forgetThread(threadId))),
    ).toBe("structured-operation-active");
    await Effect.runPromise(claim.release);
    await expect(Effect.runPromise(authority.forgetThread(threadId))).resolves.toBeUndefined();
  });
});

describe("execution adapter authority persistence", () => {
  it("migrates a version-1 terminal record without inventing an owner identity", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-v1-"));
    const filePath = path.join(directory, "execution-adapters.json");
    try {
      await fs.writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          states: [{
            threadId,
            state: {
              adapter: "terminal",
              revision: 3,
              provider: "codex",
              status: "ready",
              runtimeInstanceId: "runtime-v1",
              generation: "generation-v1",
              pid: 42,
              providerSessionId: null,
              activeTurnId: null,
              startedAt: "2026-07-25T00:00:00.000Z",
              exitCode: null,
              exitSignal: null,
              error: null,
            },
          }],
        }),
        { mode: 0o600 },
      );

      expect((await readExecutionAdapterAuthority(filePath)).get(threadId))
        .toMatchObject({
          adapter: "terminal",
          pid: 42,
          ownerIdentity: null,
          processGroupIdentity: null,
        });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("round-trips a verified terminal owner identity", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-v2-"));
    const filePath = path.join(directory, "execution-adapters.json");
    const state = {
      adapter: "terminal",
      revision: 3,
      provider: "codex",
      status: "ready",
      runtimeInstanceId: "runtime-v2",
      generation: "generation-v2",
      pid: 42,
      ownerIdentity: {
        pid: 42,
        startTime: "Sat Jul 25 00:00:00 2026",
        commandFingerprint: "a".repeat(64),
      },
      processGroupIdentity: null,
      providerSessionId: null,
      activeTurnId: null,
      startedAt: "2026-07-25T00:00:00.000Z",
      exitCode: null,
      exitSignal: null,
      error: null,
    } as const;
    try {
      await writeExecutionAdapterAuthority(filePath, new Map([[threadId, state]]));
      expect((await readExecutionAdapterAuthority(filePath)).get(threadId)).toEqual(state);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["corrupt", "{not-json"],
    ["unsupported", JSON.stringify({ version: 99, states: [] })],
  ])("quarantines a %s snapshot and fails every authority operation closed", async (_label, body) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-bad-"));
    const filePath = path.join(directory, "terminal-agent", "execution-adapters.json");
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body, { mode: 0o600 });
      const loaded = await loadExecutionAdapterAuthority(filePath);
      expect(loaded.states.size).toBe(0);
      expect(loaded.authorityUnavailableReason).toMatch(/unavailable/i);
      expect(loaded.quarantinePath).not.toBeNull();
      await expect(fs.readFile(loaded.quarantinePath!, "utf8")).resolves.toBe(body);
      const restarted = await loadExecutionAdapterAuthority(filePath);
      expect(restarted.states.size).toBe(0);
      expect(restarted.authorityUnavailableReason).toMatch(/unavailable/i);

      const authority = await Effect.runPromise(
        makeExecutionAdapterAuthority({
          initialStates: loaded.states,
          persist: () => Effect.void,
          now: () => new Date("2026-07-25T00:00:00.000Z"),
          authorityUnavailableReason: loaded.authorityUnavailableReason!,
        }),
      );
      expect(authority.safetyModeReason).toBe(loaded.authorityUnavailableReason);
      expect(await Effect.runPromise(authority.listStates)).toEqual(new Map());

      const operations = [
        authority.getState(threadId),
        authority.acquireStructured(threadId, "structured"),
        authority.reserveStructuredStart(threadId, "turn:start"),
        authority.claimStructuredStart(threadId, "turn:start"),
        authority.acquireTerminal(threadId, 0, "generation-1", "terminal"),
        authority.beginTerminalSwitch({
          threadId,
          provider: "codex",
          runtimeInstanceId: "runtime-1",
          providerSessionId: null,
          startedAt: "2026-07-25T00:00:00.000Z",
        }),
        authority.forgetThread(threadId),
      ];
      for (const [index, operation] of operations.entries()) {
        expect(
          failureReason(await Effect.runPromiseExit(operation)),
          `operation ${index}`,
        ).toBe("authority-unavailable");
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("round-trips a permission-restricted snapshot", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-"));
    const filePath = path.join(directory, "terminal-agent", "execution-adapters.json");
    try {
      await writeExecutionAdapterAuthority(
        filePath,
        new Map([[threadId, { adapter: "structured", revision: 7, status: "ready" }]]),
      );
      const decoded = await readExecutionAdapterAuthority(filePath);
      expect(decoded.get(threadId)).toEqual({
        adapter: "structured",
        revision: 7,
        status: "ready",
      });
      if (process.platform !== "win32") {
        expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("fsyncs the parent directory after publishing a snapshot", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-sync-"));
    const filePath = path.join(directory, "terminal-agent", "execution-adapters.json");
    const expected = new Map([
      [threadId, { adapter: "structured", revision: 4, status: "ready" } as const],
    ]);
    let synced = false;
    try {
      await writeExecutionAdapterAuthority(filePath, expected, {
        syncDirectory: async (directoryPath) => {
          expect(directoryPath).toBe(path.dirname(filePath));
          expect((await readExecutionAdapterAuthority(filePath)).get(threadId))
            .toEqual(expected.get(threadId));
          synced = true;
        },
      });
      expect(synced).toBe(true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("only suppresses explicit unsupported directory fsync errors", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-sync-"));
    const filePath = path.join(directory, "execution-adapters.json");
    try {
      await expect(
        writeExecutionAdapterAuthority(filePath, new Map(), {
          syncDirectory: () =>
            Promise.reject(Object.assign(new Error("unsupported"), { code: "ENOTSUP" })),
        }),
      ).resolves.toBeUndefined();
      await expect(
        writeExecutionAdapterAuthority(filePath, new Map(), {
          syncDirectory: () =>
            Promise.reject(Object.assign(new Error("disk failure"), { code: "EIO" })),
        }),
      ).rejects.toThrow("disk failure");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
