import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { TerminalAuthorityState } from "../Services/ExecutionAdapterAuthority";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import {
  readExecutionAdapterAuthority,
  writeExecutionAdapterAuthority,
} from "./executionAdapterAuthorityPersistence";

const directories: string[] = [];
const threadId = ThreadId.makeUnsafe("process-group-authority");
const ownerIdentity = {
  pid: 42,
  startTime: "Sat Jul 25 00:00:00 2026",
  commandFingerprint: "a".repeat(64),
};

function state(): TerminalAuthorityState {
  return {
    adapter: "terminal",
    revision: 3,
    provider: "codex",
    status: "ready",
    runtimeInstanceId: "runtime-process-group",
    generation: "generation-process-group",
    pid: 42,
    ownerIdentity,
    processGroupIdentity: {
      pgid: 42,
      leaderIdentity: ownerIdentity,
    },
    providerSessionId: null,
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

describe("execution adapter process-group persistence", () => {
  it("turns a proven stopped terminal directly into a structured deletion tombstone", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.void,
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-stopped",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    await Effect.runPromise(authority.beginTerminalStop(threadId));
    await Effect.runPromise(
      authority.updateTerminal({
        threadId,
        revision: starting.revision,
        patch: { status: "stopped" },
      }),
    );

    await expect(Effect.runPromise(authority.beginThreadDeletion(threadId))).resolves.toMatchObject(
      {
        adapter: "structured",
        status: "deleting",
      },
    );
  });

  it("round-trips a verified POSIX process-group identity", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-group-"));
    directories.push(directory);
    const filePath = path.join(directory, "execution-adapters.json");

    await writeExecutionAdapterAuthority(filePath, new Map([[threadId, state()]]));

    await expect(readExecutionAdapterAuthority(filePath)).resolves.toEqual(
      new Map([[threadId, state()]]),
    );
  });

  it("migrates a version-2 owner identity with no invented process group", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-v2-group-"));
    directories.push(directory);
    const filePath = path.join(directory, "execution-adapters.json");
    const legacy = state();
    const { processGroupIdentity: _, ...legacyState } = legacy;
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 2,
        states: [{ threadId, state: legacyState }],
      }),
      { mode: 0o600 },
    );

    expect((await readExecutionAdapterAuthority(filePath)).get(threadId)).toMatchObject({
      ownerIdentity,
      processGroupIdentity: null,
    });
  });

  it("rejects a group identity that does not match its durable owner", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-authority-bad-group-"));
    directories.push(directory);
    const filePath = path.join(directory, "execution-adapters.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 3,
        states: [
          {
            threadId,
            state: {
              ...state(),
              processGroupIdentity: {
                pgid: 43,
                leaderIdentity: { ...ownerIdentity, pid: 43 },
              },
            },
          },
        ],
      }),
      { mode: 0o600 },
    );

    await expect(readExecutionAdapterAuthority(filePath)).rejects.toThrow(
      "process-group identity does not match",
    );
  });
});
