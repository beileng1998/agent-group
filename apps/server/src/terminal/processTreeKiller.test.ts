// FILE: processTreeKiller.test.ts
// Purpose: Verifies PTY process-tree capture and stable-identity signaling.
// Layer: Terminal infrastructure tests
// Depends on: Vitest and injectable processTreeKiller dependencies.
import { describe, expect, it, vi } from "vitest";

import {
  captureDescendantProcessTree,
  collectDescendantProcesses,
  createProcessTreeKiller,
  parseProcessCommandMap,
  parseProcessIdentityMap,
  processIdentitySnapshotFromPsResult,
  type CapturedProcessTree,
  type ProcessChildrenMap,
  type TerminalKillSignal,
} from "./processTreeKiller";

describe("processTreeKiller", () => {
  it("collects nested process-tree descendants in parent-first order", () => {
    const childrenByParentPid: ProcessChildrenMap = new Map([
      [
        100,
        [
          { pid: 101, command: "zsh" },
          { pid: 102, command: "bun run dev" },
        ],
      ],
      [102, [{ pid: 103, command: "tsdown --watch" }]],
    ]);

    expect(collectDescendantProcesses(100, childrenByParentPid)).toEqual([
      { pid: 101, command: "zsh" },
      { pid: 102, command: "bun run dev" },
      { pid: 103, command: "tsdown --watch" },
    ]);
  });

  it("marks a process-tree snapshot incomplete when the bounded walk truncates", () => {
    const children = Array.from({ length: 257 }, (_, index) => ({
      pid: 1_000 + index,
      command: `worker-${index}`,
      startTime: `Sun Jul 19 15:00:${String(index % 60).padStart(2, "0")} 2026`,
    }));
    const tree = captureDescendantProcessTree(100, new Map([[100, children]]));

    expect(tree.descendants).toHaveLength(256);
    expect(tree.captureComplete).toBe(false);
  });

  it("marks a process-tree snapshot incomplete when stable start identity is unavailable", () => {
    const tree = captureDescendantProcessTree(
      100,
      new Map([[100, [{ pid: 101, command: "provider-worker" }]]]),
    );

    expect(tree.descendants).toHaveLength(1);
    expect(tree.captureComplete).toBe(false);
  });

  it("captures stable root and descendant identities as one complete snapshot", () => {
    const root = {
      pid: 100,
      command: "codex app-server",
      startTime: "Sun Jul 19 15:00:00 2026",
    };
    const descendant = {
      pid: 101,
      command: "provider-worker",
      startTime: "Sun Jul 19 15:00:01 2026",
    };
    const tree = captureDescendantProcessTree(
      100,
      new Map([
        [1, [root]],
        [100, [descendant]],
      ]),
    );

    expect(tree).toEqual({ root, descendants: [descendant], captureComplete: true });
  });

  it("parses current command snapshots with command arguments intact", () => {
    expect(
      parseProcessCommandMap(`
        102 bun run dev -- --watch
        103 /bin/zsh -l
      `),
    ).toEqual(
      new Map([
        [102, "bun run dev -- --watch"],
        [103, "/bin/zsh -l"],
      ]),
    );
  });

  it("parses stable process start identities independently from command changes", () => {
    expect(
      parseProcessIdentityMap(
        "102 Sun Jul 19 15:00:01 2026 /bin/zsh -l\n" +
          "103 Sun Jul 19 15:00:02 2026 node worker.js\n",
      ),
    ).toEqual(
      new Map([
        [102, { command: "/bin/zsh -l", startTime: "Sun Jul 19 15:00:01 2026" }],
        [103, { command: "node worker.js", startTime: "Sun Jul 19 15:00:02 2026" }],
      ]),
    );
  });

  it("treats ps status 1 with no output as proof that captured processes exited", () => {
    expect(processIdentitySnapshotFromPsResult({ status: 1, stdout: "", stderr: "" })).toEqual(
      new Map(),
    );
    expect(
      processIdentitySnapshotFromPsResult({
        status: 1,
        stdout: "",
        stderr: "ps: unsupported process query",
      }),
    ).toBeNull();
  });

  it("validates captured root and child identities before delayed SIGKILL", () => {
    const signaledPids: Array<{ pid: number; signal: TerminalKillSignal }> = [];
    const commandReadCalls: number[][] = [];
    const tree: CapturedProcessTree = {
      root: {
        pid: 100,
        command: "codex app-server",
        startTime: "Sun Jul 19 15:00:00 2026",
      },
      descendants: [
        { pid: 102, command: "bun run dev", startTime: "Sun Jul 19 15:00:01 2026" },
        { pid: 103, command: "tsdown --watch", startTime: "Sun Jul 19 15:00:02 2026" },
      ],
    };
    const killer = createProcessTreeKiller({
      readCurrentIdentities: (pids) => {
        commandReadCalls.push([...pids]);
        return new Map([
          [100, { command: "codex app-server", startTime: "Sun Jul 19 15:00:00 2026" }],
          [102, { command: "node changed-after-exec.js", startTime: "Sun Jul 19 15:00:01 2026" }],
          [103, { command: "tsdown --watch", startTime: "Sun Jul 19 15:00:03 2026" }],
        ]);
      },
      signalPid: (pid, signal) => {
        signaledPids.push({ pid, signal });
        return null;
      },
      platform: "darwin",
    });

    killer.signal({
      rootPid: 100,
      signal: "SIGKILL",
      tree,
      onError: () => undefined,
    });

    expect(signaledPids).toEqual([
      { pid: 102, signal: "SIGKILL" },
      { pid: 100, signal: "SIGKILL" },
    ]);
    expect(commandReadCalls).toEqual([[102, 103, 100]]);
  });

  it("validates captured child identities before initial SIGTERM", () => {
    const signaledPids: number[] = [];
    const killer = createProcessTreeKiller({
      readCurrentIdentities: () =>
        new Map([
          [100, { command: "codex app-server", startTime: "Sun Jul 19 15:00:00 2026" }],
          [103, { command: "tsdown --watch", startTime: "Sun Jul 19 15:00:03 2026" }],
        ]),
      signalPid: (pid) => {
        signaledPids.push(pid);
        return null;
      },
      platform: "darwin",
    });

    killer.signal({
      rootPid: 100,
      signal: "SIGTERM",
      tree: {
        root: {
          pid: 100,
          command: "codex app-server",
          startTime: "Sun Jul 19 15:00:00 2026",
        },
        descendants: [
          { pid: 102, command: "bun run dev", startTime: "Sun Jul 19 15:00:01 2026" },
          { pid: 103, command: "tsdown --watch", startTime: "Sun Jul 19 15:00:03 2026" },
        ],
      },
      onError: () => undefined,
    });

    expect(signaledPids).toEqual([103, 100]);
  });

  it("can skip root tree signaling while still signaling captured children", () => {
    const signaledPids: number[] = [];
    const killer = createProcessTreeKiller({
      readCurrentIdentities: () =>
        new Map([
          [103, { command: "different-after-exec", startTime: "Sun Jul 19 15:00:03 2026" }],
        ]),
      signalPid: (pid) => {
        signaledPids.push(pid);
        return null;
      },
      platform: "darwin",
    });

    killer.signal({
      rootPid: 100,
      signal: "SIGKILL",
      includeRootTree: false,
      tree: {
        descendants: [
          { pid: 103, command: "tsdown --watch", startTime: "Sun Jul 19 15:00:03 2026" },
        ],
      },
      onError: () => undefined,
    });

    expect(signaledPids).toEqual([103]);
  });

  it("uses one synchronous taskkill boundary for Windows process trees", () => {
    const signalWindowsTree = vi.fn(() => null);
    const signalPid = vi.fn((_pid: number, _signal: TerminalKillSignal) => null);
    const readCurrentIdentities = vi.fn(() => new Map());
    const killer = createProcessTreeKiller({
      platform: "win32",
      signalWindowsTree,
      signalPid,
      readCurrentIdentities,
    });

    const tree: CapturedProcessTree = {
      descendants: [],
      captureComplete: true,
      platformTreeExitProven: false,
    };
    killer.signal({
      rootPid: 100,
      signal: "SIGTERM",
      tree,
      onError: () => undefined,
    });

    expect(signalWindowsTree).toHaveBeenCalledWith(100, "SIGTERM");
    expect(signalPid).not.toHaveBeenCalled();
    expect(readCurrentIdentities).not.toHaveBeenCalled();
    expect(killer.inspect?.(tree)).toEqual({ verified: true, survivors: [] });
  });

  it("does not prove Windows descendant exit when taskkill fails", () => {
    const killer = createProcessTreeKiller({
      platform: "win32",
      signalWindowsTree: () => new Error("taskkill unavailable"),
    });
    const tree: CapturedProcessTree = {
      descendants: [],
      captureComplete: true,
      platformTreeExitProven: false,
    };

    killer.signal({
      rootPid: 100,
      signal: "SIGTERM",
      tree,
      onError: () => undefined,
    });

    expect(killer.inspect?.(tree)).toEqual({ verified: false, survivors: [] });
  });

  it("keeps an explicit legacy PTY fallback alongside captured identity signals", () => {
    const signalLegacyTree = vi.fn(
      (_rootPid: number, _signal: TerminalKillSignal, callback: () => void) => callback(),
    );
    const signalPid = vi.fn((_pid: number, _signal: TerminalKillSignal) => null);
    const killer = createProcessTreeKiller({
      platform: "darwin",
      signalLegacyTree,
      signalPid,
      readCurrentIdentities: () =>
        new Map([
          [100, { command: "terminal-root", startTime: "Sun Jul 19 15:00:00 2026" }],
          [101, { command: "terminal-child", startTime: "Sun Jul 19 15:00:01 2026" }],
        ]),
    });

    killer.signal({
      rootPid: 100,
      signal: "SIGTERM",
      tree: {
        root: {
          pid: 100,
          command: "terminal-root",
          startTime: "Sun Jul 19 15:00:00 2026",
        },
        descendants: [
          {
            pid: 101,
            command: "terminal-child",
            startTime: "Sun Jul 19 15:00:01 2026",
          },
        ],
        captureComplete: false,
      },
      allowLegacyTreeFallback: true,
      onError: () => undefined,
    });

    expect(signalLegacyTree).toHaveBeenCalledTimes(1);
    expect(signalPid.mock.calls.map(([pid]) => pid)).toEqual([101, 100]);
  });

  it("never starts the legacy tree walk after root exit", () => {
    const signalLegacyTree = vi.fn();
    const signalPid = vi.fn((_pid: number, _signal: TerminalKillSignal) => null);
    const killer = createProcessTreeKiller({
      platform: "darwin",
      signalLegacyTree,
      signalPid,
      readCurrentIdentities: () =>
        new Map([[101, { command: "terminal-child", startTime: "Sun Jul 19 15:00:01 2026" }]]),
    });

    killer.signal({
      rootPid: 100,
      signal: "SIGKILL",
      includeRootTree: false,
      allowLegacyTreeFallback: true,
      tree: {
        descendants: [
          {
            pid: 101,
            command: "terminal-child",
            startTime: "Sun Jul 19 15:00:01 2026",
          },
        ],
        captureComplete: false,
      },
      onError: () => undefined,
    });

    expect(signalLegacyTree).not.toHaveBeenCalled();
    expect(signalPid).toHaveBeenCalledWith(101, "SIGKILL");
  });
});
