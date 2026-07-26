import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { TerminalAuthorityState } from "../orchestration/Services/ExecutionAdapterAuthority";
import { captureTerminalOwnerIdentity } from "../terminal/terminalProcessIdentity";
import { terminalAgentRuntimeDir } from "./terminalAgentDriverRegistry";
import { makeTerminalAgentPersistedRecovery } from "./terminalAgentPersistedRecovery";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

const directories: string[] = [];
const threadId = ThreadId.makeUnsafe("persisted-runtime-thread");

function authority(
  provider: "codex" | "claudeAgent",
  runtimeInstanceId: string,
): TerminalAuthorityState {
  return {
    adapter: "terminal",
    revision: 7,
    provider,
    status: "ready",
    runtimeInstanceId,
    generation: "generation-1",
    pid: 42,
    ownerIdentity: {
      pid: 42,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: "session-1",
    activeTurnId: null,
    startedAt: "2026-07-25T00:00:00.000Z",
    exitCode: null,
    exitSignal: null,
    error: null,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("persisted Agent Terminal runtime cleanup", () => {
  it("blocks detached lifecycle operations while the persisted PID is occupied", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const recovery = makeTerminalAgentPersistedRecovery({
      stateDir,
      records: new Map(),
    });

    await expect(
      Effect.runPromise(
        recovery.ensureDetachedOwnerExited(
          {
            ...authority("codex", "runtime-old"),
            pid: process.pid,
            ownerIdentity: captureTerminalOwnerIdentity(process.pid),
          },
          undefined,
        ),
      ),
    ).rejects.toThrow("Refusing to spawn a duplicate");
  });

  it("leaves lifecycle teardown to TerminalHost when this process owns the runtime", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const runtime = {
      threadId,
      runtimeDir: path.join(stateDir, "terminal-agent", "owned"),
    } as TerminalAgentRuntimeRecord;
    const recovery = makeTerminalAgentPersistedRecovery({
      stateDir,
      records: new Map([[threadId, runtime]]),
    });

    await expect(
      Effect.runPromise(
        recovery.ensureDetachedOwnerExited(authority("codex", "runtime-old"), runtime),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows a durably stopped terminal with no remaining ownership", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const recovery = makeTerminalAgentPersistedRecovery({
      stateDir,
      records: new Map(),
    });

    await expect(
      Effect.runPromise(
        recovery.ensureDetachedOwnerExited(
          {
            ...authority("codex", "runtime-stopped"),
            status: "stopped",
            pid: null,
            ownerIdentity: null,
            processGroupIdentity: null,
          },
          undefined,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks a pre-persistence spawn crash with no durable ownership", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const recovery = makeTerminalAgentPersistedRecovery({
      stateDir,
      records: new Map(),
    });

    await expect(
      Effect.runPromise(
        recovery.ensureDetachedOwnerExited(
          {
            ...authority("codex", "runtime-starting"),
            status: "starting",
            generation: null,
            pid: null,
            ownerIdentity: null,
            processGroupIdentity: null,
          },
          undefined,
        ),
      ),
    ).rejects.toThrow("no persisted PID or process-group identity");
  });

  it("retires a distinct pre-crash Claude runtime after replacement", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const oldState = authority("claudeAgent", "runtime-old");
    const oldDir = terminalAgentRuntimeDir({
      stateDir,
      threadId,
      runtimeInstanceId: oldState.runtimeInstanceId,
      provider: "claudeAgent",
    });
    const newDir = terminalAgentRuntimeDir({
      stateDir,
      threadId,
      runtimeInstanceId: "runtime-new",
      provider: "claudeAgent",
    });
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, "hook-token"), "secret");
    await fs.mkdir(newDir, { recursive: true });
    const records = new Map<ThreadId, TerminalAgentRuntimeRecord>([
      [threadId, { threadId, runtimeDir: newDir } as TerminalAgentRuntimeRecord],
    ]);
    const recovery = makeTerminalAgentPersistedRecovery({ stateDir, records });

    await Effect.runPromise(recovery.retirePreviousRuntime(threadId, oldState));

    await expect(fs.lstat(oldDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(newDir)).resolves.toMatchObject({});
  });

  it("preserves the stable Codex runtime directory used by the replacement", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-persisted-runtime-"));
    directories.push(stateDir);
    const oldState = authority("codex", "runtime-old");
    const stableDir = terminalAgentRuntimeDir({
      stateDir,
      threadId,
      runtimeInstanceId: oldState.runtimeInstanceId,
      provider: "codex",
    });
    await fs.mkdir(stableDir, { recursive: true });
    await fs.writeFile(path.join(stableDir, "resume-state"), "keep");
    const records = new Map<ThreadId, TerminalAgentRuntimeRecord>([
      [threadId, { threadId, runtimeDir: stableDir } as TerminalAgentRuntimeRecord],
    ]);
    const recovery = makeTerminalAgentPersistedRecovery({ stateDir, records });

    await Effect.runPromise(recovery.retirePreviousRuntime(threadId, oldState));

    await expect(fs.readFile(path.join(stableDir, "resume-state"), "utf8")).resolves.toBe("keep");
  });
});
