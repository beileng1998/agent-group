import { describe, expect, it, vi } from "vitest";

import type { PtyProcess } from "../terminal/Services/PTY";
import type { ProcessTreeKiller } from "../terminal/processTreeKiller";
import type { TerminalProcessGroupController } from "../terminal/terminalProcessGroup";
import { TerminalHost } from "./TerminalHost";

function fakePty(kill: (signal?: string) => void): PtyProcess {
  return {
    pid: 42_001,
    write: () => {},
    resize: () => {},
    kill,
    pause: () => {},
    resume: () => {},
    onData: () => () => {},
    onExit: () => () => {},
  };
}

function observableFakePty() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener:
    | ((event: { exitCode: number; signal: number | null }) => void)
    | undefined;
  const pty: PtyProcess = {
    ...fakePty(() => {}),
    onData: (listener) => {
      dataListener = listener;
      return () => {
        dataListener = undefined;
      };
    },
    onExit: (listener) => {
      exitListener = listener;
      return () => {
        exitListener = undefined;
      };
    },
  };
  return {
    pty,
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode, signal: null }),
  };
}

describe("TerminalHost durable process-group ownership", () => {
  it("buffers output emitted while durable ownership is captured", async () => {
    const fake = observableFakePty();
    const capture = vi.fn((pid: number) => ({
      root: { pid, command: "fake", startTime: "root-start" },
      descendants: [],
      captureComplete: true,
    }));
    const processTreeKiller: ProcessTreeKiller = {
      capture,
      signal: () => {},
      inspect: () => ({ verified: true, survivors: [] }),
    };
    const controller: TerminalProcessGroupController = {
      capture: (pid) => {
        fake.emitData("startup-output");
        return {
          pgid: pid,
          leaderIdentity: {
            pid,
            startTime: "root-start",
            commandFingerprint: "0".repeat(64),
          },
        };
      },
      inspect: () => ({ status: "absent", detail: null }),
      signal: () => null,
    };
    const host = new TerminalHost({
      spawnPty: async () => fake.pty,
      processTreeKiller,
      processGroupController: controller,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });

    await host.createOrAttach({
      sessionId: "startup-output",
      command: "fake",
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });
    const attached = await host.attach("startup-output");
    fake.emitData("live-output");

    expect(attached.snapshot?.snapshotAnsi).toContain("startup-output");
    expect(attached.snapshot?.outputSequence).toBe(1);
    expect(capture).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it("latches an exit emitted while durable ownership is captured", async () => {
    const fake = observableFakePty();
    const processTreeKiller: ProcessTreeKiller = {
      capture: (pid) => ({
        root: { pid, command: "fake", startTime: "root-start" },
        descendants: [],
        captureComplete: true,
      }),
      signal: () => {},
      inspect: () => ({ verified: true, survivors: [] }),
    };
    const controller: TerminalProcessGroupController = {
      capture: (pid) => {
        fake.emitExit(23);
        return {
          pgid: pid,
          leaderIdentity: {
            pid,
            startTime: "root-start",
            commandFingerprint: "0".repeat(64),
          },
        };
      },
      inspect: () => ({ status: "absent", detail: null }),
      signal: () => null,
    };
    const host = new TerminalHost({
      spawnPty: async () => fake.pty,
      processTreeKiller,
      processGroupController: controller,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });

    await expect(
      host.createOrAttach({
        sessionId: "startup-exit",
        command: "fake",
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("Terminal host session not found");
    expect(host.isAlive("startup-exit")).toBe(false);
    await host.dispose();
  });

  it("fails the POSIX spawn closed when group ownership cannot be captured", async () => {
    const kill = vi.fn();
    let rootAlive = true;
    const signal = vi.fn(() => {
      rootAlive = false;
    });
    const processTreeKiller: ProcessTreeKiller = {
      capture: (pid) => ({
        root: { pid, command: "fake", startTime: "root-start" },
        descendants: [],
        captureComplete: true,
      }),
      signal,
      inspect: (tree) => ({
        verified: true,
        survivors: rootAlive && tree.root ? [tree.root] : [],
      }),
    };
    const controller: TerminalProcessGroupController = {
      capture: () => null,
      inspect: () => ({ status: "unverified", detail: "unavailable" }),
      signal: () => new Error("unavailable"),
    };
    const host = new TerminalHost({
      spawnPty: async () => fakePty(kill),
      processTreeKiller,
      processGroupController: controller,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });

    await expect(
      host.createOrAttach({
        sessionId: "missing-group",
        command: "fake",
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("has no verified process group");
    expect(signal).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
    expect(host.isAlive("missing-group")).toBe(false);
    await host.dispose();
  });

  it("retains an unverified spawn and blocks replacement until cleanup is proven", async () => {
    let allowCleanup = false;
    let rootAlive = true;
    let spawnCalls = 0;
    const processTreeKiller: ProcessTreeKiller = {
      capture: (pid) =>
        allowCleanup
          ? {
              root: { pid, command: "fake", startTime: "root-start" },
              descendants: [],
              captureComplete: true,
            }
          : { descendants: [], captureComplete: false },
      signal: () => {
        if (allowCleanup) rootAlive = false;
      },
      inspect: (tree) =>
        allowCleanup
          ? {
              verified: true,
              survivors: rootAlive && tree.root ? [tree.root] : [],
            }
          : { verified: false, survivors: [] },
    };
    const controller: TerminalProcessGroupController = {
      capture: () => null,
      inspect: () => ({ status: "unverified", detail: "unavailable" }),
      signal: () => new Error("unavailable"),
    };
    const host = new TerminalHost({
      spawnPty: async () => {
        spawnCalls += 1;
        rootAlive = true;
        return fakePty(vi.fn());
      },
      processTreeKiller,
      processGroupController: controller,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });
    const input = {
      sessionId: "unverified-group",
      command: "fake",
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    };

    await expect(host.createOrAttach(input)).rejects.toThrow(
      "process-group capture failed",
    );
    await expect(host.createOrAttach(input)).rejects.toThrow(
      "captured process tree exit is unverified",
    );
    expect(spawnCalls).toBe(1);

    allowCleanup = true;
    await host.kill(input.sessionId);
    expect(rootAlive).toBe(false);
    await expect(host.createOrAttach(input)).rejects.toThrow(
      "has no verified process group",
    );
    expect(spawnCalls).toBe(2);
    await host.dispose();
  });
});
