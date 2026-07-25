import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import { piTerminalSessionDir } from "./piTerminalDriver";
import { makeTerminalProviderCursorAdopter } from "./terminalAgentProviderCursorAdoption";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

describe("terminal provider cursor adoption", () => {
  it("adopts only a managed Pi file whose header id matches the runtime", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-group-pi-cursor-"),
    );
    const sessionDir = piTerminalSessionDir(stateDir);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, "session.jsonl");
    const writeHeader = (id: string) =>
      fs.writeFile(
        sessionPath,
        `${JSON.stringify({
          type: "session",
          id,
          cwd: stateDir,
        })}\n`,
      );
    await writeHeader("expected-session");
    const adoptSessionResumeCursor = vi.fn(() => Effect.void);
    const adopt = makeTerminalProviderCursorAdopter(
      { adoptSessionResumeCursor } as unknown as ProviderServiceShape,
      {
        acquireTerminalOperation: () =>
          Effect.succeed({ release: Effect.void }),
      } as unknown as ExecutionAdapterCoordinatorShape,
      stateDir,
    );
    const runtime = {
      threadId: "thread-pi-cursor",
      provider: "pi",
      runtimeMode: "approval-required",
      runtimeInstanceId: "runtime-pi-cursor",
      revision: 2,
      generation: "generation-pi-cursor",
      providerSessionId: "expected-session",
      workspaceRoot: stateDir,
    } as TerminalAgentRuntimeRecord;

    try {
      await adopt(runtime, sessionPath, "expected-session");
      expect(adoptSessionResumeCursor).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeCursor: {
            path: await fs.realpath(sessionPath),
            sessionId: "expected-session",
          },
        }),
      );

      await writeHeader("attacker-session");
      await expect(
        adopt(runtime, sessionPath, "expected-session"),
      ).rejects.toThrow("id does not match");
      expect(adoptSessionResumeCursor).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("holds a separate terminal claim until the provider binding write settles", async () => {
    let finishWrite: (() => void) | undefined;
    let markWriteEntered: (() => void) | undefined;
    const writeEntered = new Promise<void>((resolve) => {
      markWriteEntered = resolve;
    });
    const writeFinished = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    let releases = 0;
    const acquireTerminalOperation = vi.fn(() =>
      Effect.succeed({
        threadId: "thread-cursor",
        claimId: "cursor:runtime-cursor",
        revision: 3,
        generation: "generation-cursor",
        release: Effect.sync(() => {
          releases += 1;
        }),
      }),
    );
    const adoptSessionResumeCursor = vi.fn(() =>
      Effect.tryPromise(async () => {
        markWriteEntered?.();
        await writeFinished;
      }),
    );
    const adopt = makeTerminalProviderCursorAdopter(
      { adoptSessionResumeCursor } as unknown as ProviderServiceShape,
      { acquireTerminalOperation } as unknown as ExecutionAdapterCoordinatorShape,
      "/state",
    );
    const runtime = {
      threadId: "thread-cursor",
      provider: "codex",
      runtimeMode: "approval-required",
      runtimeInstanceId: "runtime-cursor",
      revision: 3,
      generation: "generation-cursor",
    } as TerminalAgentRuntimeRecord;

    const adopting = adopt(
      runtime,
      { threadId: "provider-cursor" },
      "provider-cursor",
    );
    await writeEntered;
    expect(releases).toBe(0);
    expect(acquireTerminalOperation).toHaveBeenCalledWith({
      threadId: "thread-cursor",
      revision: 3,
      generation: "generation-cursor",
      claimId: "cursor:runtime-cursor",
    });

    finishWrite?.();
    await adopting;
    expect(releases).toBe(1);
  });
});
