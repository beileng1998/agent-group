import { describe, expect, it } from "vitest";

import type { PtyProcess } from "../terminal/Services/PTY";
import type {
  CapturedProcess,
  CapturedProcessTree,
  ProcessTreeKiller,
} from "../terminal/processTreeKiller";
import type { TerminalProcessGroupController } from "../terminal/terminalProcessGroup";
import {
  TerminalHost,
  TerminalHostSessionNotFoundError,
  TerminalHostTeardownError,
} from "./TerminalHost";

interface FakePtyController {
  readonly pty: PtyProcess;
  emitData(data: string): void;
  emitExit(exitCode?: number): void;
  exitListenerCount(): number;
}

function makeFakePty(
  pid: number,
  options: { readonly exitOnKill?: boolean } = {},
): FakePtyController {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number; signal: number | null }) => void>();
  let exited = false;
  const emitExit = (exitCode = 0) => {
    if (exited) return;
    exited = true;
    for (const listener of exitListeners) {
      listener({ exitCode, signal: null });
    }
  };
  return {
    pty: {
      pid,
      write: () => {},
      resize: () => {},
      kill: () => {
        if (options.exitOnKill !== false) emitExit();
      },
      pause: () => {},
      resume: () => {},
      onData: (listener) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      },
      onExit: (listener) => {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
    },
    emitData: (data) => {
      for (const listener of dataListeners) listener(data);
    },
    emitExit,
    exitListenerCount: () => exitListeners.size,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function processTree(
  rootPid: number,
  descendants: readonly CapturedProcess[],
): CapturedProcessTree {
  return {
    root: {
      pid: rootPid,
      command: "fake-agent",
      startTime: "root-start",
    },
    descendants: [...descendants],
    captureComplete: true,
  };
}

const spawnInput = {
  sessionId: "natural-exit",
  command: "fake-agent",
  cwd: process.cwd(),
  cols: 80,
  rows: 24,
};

describe("TerminalHost natural root exit teardown", () => {
  it("kills and verifies the durable process group after the root exits", async () => {
    const fake = makeFakePty(41_001);
    let rootExited = false;
    let childAlive = true;
    const killer: ProcessTreeKiller = {
      capture: (rootPid) =>
        rootExited ? { descendants: [], captureComplete: false } : processTree(rootPid, []),
      signal: () => {},
      inspect: () => ({ verified: true, survivors: [] }),
    };
    const groupController: TerminalProcessGroupController = {
      capture: (pid) => ({
        pgid: pid,
        leaderIdentity: {
          pid,
          startTime: "root-start",
          commandFingerprint: "0".repeat(64),
        },
      }),
      signal: () => {
        childAlive = false;
        return null;
      },
      inspect: () =>
        childAlive ? { status: "owned", detail: null } : { status: "absent", detail: null },
    };
    const host = new TerminalHost({
      spawnPty: async () => fake.pty,
      processTreeKiller: killer,
      processGroupController: groupController,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });

    try {
      await host.createOrAttach(spawnInput);
      const exited = new Promise<number>((resolve) => {
        host.onExit(spawnInput.sessionId, (event) => resolve(event.exitCode));
      });
      rootExited = true;
      fake.emitExit(7);

      await expect(exited).resolves.toBe(7);
      await waitFor(() => !childAlive);
      expect(childAlive).toBe(false);
      expect(host.isKilled(spawnInput.sessionId)).toBe(false);
      await expect(host.attach(spawnInput.sessionId)).rejects.toThrow(
        TerminalHostSessionNotFoundError,
      );
    } finally {
      await host.dispose();
    }
  });

  it("retains an unverified owner and gates replacement until retry succeeds", async () => {
    const first = makeFakePty(42_001);
    const second = makeFakePty(42_101);
    let rootExited = false;
    let childAlive = true;
    let allowCleanup = false;
    let spawnCalls = 0;
    let inspections = 0;
    const killer: ProcessTreeKiller = {
      capture: (rootPid) => {
        if (rootPid === first.pty.pid) {
          return rootExited
            ? { descendants: [], captureComplete: false }
            : processTree(rootPid, []);
        }
        return processTree(rootPid, []);
      },
      signal: () => {},
      inspect: () => ({ verified: true, survivors: [] }),
    };
    const groupController: TerminalProcessGroupController = {
      capture: (pid) => ({
        pgid: pid,
        leaderIdentity: {
          pid,
          startTime: "root-start",
          commandFingerprint: "0".repeat(64),
        },
      }),
      signal: () => {
        if (allowCleanup) childAlive = false;
        return null;
      },
      inspect: () => {
        inspections += 1;
        return childAlive ? { status: "owned", detail: null } : { status: "absent", detail: null };
      },
    };
    const host = new TerminalHost({
      spawnPty: async () => {
        spawnCalls += 1;
        return spawnCalls === 1 ? first.pty : second.pty;
      },
      processTreeKiller: killer,
      processGroupController: groupController,
      requireProcessGroupOwnership: true,
      platform: "darwin",
      killGraceMs: 1,
    });

    try {
      await host.createOrAttach(spawnInput);
      rootExited = true;
      first.emitExit(9);
      await waitFor(() => inspections >= 1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await expect(host.createOrAttach(spawnInput)).rejects.toThrow(TerminalHostTeardownError);
      expect(spawnCalls).toBe(1);

      allowCleanup = true;
      const replacement = await host.createOrAttach(spawnInput);
      expect(replacement.isNew).toBe(true);
      expect(spawnCalls).toBe(2);
      expect(childAlive).toBe(false);
    } finally {
      allowCleanup = true;
      await host.dispose();
    }
  });

  it("removes timed-out exit waiters before a failed teardown is retried", async () => {
    const fake = makeFakePty(43_001, { exitOnKill: false });
    const root = {
      pid: fake.pty.pid,
      command: "stubborn-agent",
      startTime: "root-start",
    };
    let allowCleanup = false;
    const killer: ProcessTreeKiller = {
      capture: () => ({
        root,
        descendants: [],
        captureComplete: true,
      }),
      signal: () => {},
      inspect: () => ({
        verified: true,
        survivors: allowCleanup ? [] : [root],
      }),
    };
    const host = new TerminalHost({
      spawnPty: async () => fake.pty,
      processTreeKiller: killer,
      platform: "darwin",
      killGraceMs: 1,
    });

    try {
      await host.createOrAttach(spawnInput);
      expect(fake.exitListenerCount()).toBe(1);

      await expect(host.kill(spawnInput.sessionId)).rejects.toThrow(TerminalHostTeardownError);
      expect(fake.exitListenerCount()).toBe(1);
      await expect(host.kill(spawnInput.sessionId)).rejects.toThrow(TerminalHostTeardownError);
      expect(fake.exitListenerCount()).toBe(1);
    } finally {
      allowCleanup = true;
      fake.emitExit();
      await host.dispose();
    }
  });

  it("never retargets a naturally exited Windows root PID", async () => {
    const fake = makeFakePty(44_001);
    const includeRootTree: boolean[] = [];
    let cleanupVerified = false;
    let spawnCalls = 0;
    const killer: ProcessTreeKiller = {
      capture: () => ({
        descendants: [],
        captureComplete: true,
        platformTreeExitProven: false,
      }),
      signal: (input) => {
        includeRootTree.push(input.includeRootTree ?? true);
      },
      inspect: () => ({
        verified: cleanupVerified,
        survivors: [],
      }),
    };
    const host = new TerminalHost({
      spawnPty: async () => {
        spawnCalls += 1;
        return fake.pty;
      },
      processTreeKiller: killer,
      platform: "win32",
      killGraceMs: 1,
    });

    try {
      await host.createOrAttach(spawnInput);
      fake.emitExit(0);
      await waitFor(() => includeRootTree.length > 0);

      await expect(host.createOrAttach(spawnInput)).rejects.toThrow(TerminalHostTeardownError);
      expect(spawnCalls).toBe(1);
      expect(includeRootTree.every((included) => included === false)).toBe(true);
    } finally {
      cleanupVerified = true;
      await host.dispose();
    }
  });
});
