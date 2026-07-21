import { describe, expect, it, vi } from "vitest";

import type {
  CapturedProcess,
  CapturedProcessTree,
  ProcessTreeKiller,
  TerminalKillSignal,
} from "../terminal/processTreeKiller.ts";
import { createProcessTreeKiller } from "../terminal/processTreeKiller.ts";
import {
  ProviderProcessExitUnprovenError,
  teardownProviderProcessTree,
} from "./supervisedProcessTeardown.ts";

function deterministicClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("teardownProviderProcessTree", () => {
  it("never captures or signals a root whose exit was already observed", async () => {
    const capture = vi.fn(() => ({ descendants: [], captureComplete: true }));
    const signal = vi.fn();
    const failure = await teardownProviderProcessTree(
      { rootPid: 99, rootExited: Promise.resolve() },
      {
        processTreeKiller: { capture, inspect: vi.fn(), signal },
        ...deterministicClock(),
      },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "ProviderProcessExitUnprovenError",
      rootExited: true,
    });
    expect(capture).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });

  it("returns after a graceful TERM only when exit proof is complete", async () => {
    const tree: CapturedProcessTree = { descendants: [], captureComplete: true };
    let resolveRootExit: (() => void) | undefined;
    const rootExited = new Promise<void>((resolve) => {
      resolveRootExit = resolve;
    });
    const processTreeKiller: ProcessTreeKiller = {
      capture: () => tree,
      inspect: () => ({ verified: true, survivors: [] }),
      signal: ({ signal }) => {
        if (signal === "SIGTERM") resolveRootExit?.();
      },
    };

    await expect(
      teardownProviderProcessTree(
        { rootPid: 100, rootExited, termGraceMs: 5 },
        { processTreeKiller, ...deterministicClock() },
      ),
    ).resolves.toEqual({ escalated: false, signalErrors: [] });
  });

  it("escalates ignored TERM and waits for root and descendant exit proof", async () => {
    const tree: CapturedProcessTree = {
      descendants: [{ pid: 102, command: "provider-worker" }],
      captureComplete: true,
    };
    const survivors = new Map<number, CapturedProcess>([[102, tree.descendants[0]!]]);
    const signals: Array<{ signal: TerminalKillSignal; includeRootTree?: boolean }> = [];
    let resolveRootExit: (() => void) | undefined;
    const rootExited = new Promise<void>((resolve) => {
      resolveRootExit = resolve;
    });
    const processTreeKiller: ProcessTreeKiller = {
      capture: () => tree,
      inspect: () => ({ verified: true, survivors: [...survivors.values()] }),
      signal: ({ signal, includeRootTree }) => {
        signals.push({
          signal,
          ...(includeRootTree !== undefined ? { includeRootTree } : {}),
        });
        if (signal === "SIGKILL") {
          survivors.clear();
          resolveRootExit?.();
        }
      },
    };

    await expect(
      teardownProviderProcessTree(
        { rootPid: 101, rootExited, termGraceMs: 10, forceExitMs: 10, pollMs: 5 },
        { processTreeKiller, ...deterministicClock() },
      ),
    ).resolves.toEqual({ escalated: true, signalErrors: [] });
    expect(signals).toEqual([
      { signal: "SIGTERM", includeRootTree: true },
      { signal: "SIGKILL", includeRootTree: true },
    ]);
  });

  it("force-kills captured descendants without re-signalling an exited root", async () => {
    const tree: CapturedProcessTree = {
      descendants: [{ pid: 202, command: "provider-grandchild" }],
      captureComplete: true,
    };
    let descendantsRunning = true;
    let resolveRootExit: (() => void) | undefined;
    const rootExited = new Promise<void>((resolve) => {
      resolveRootExit = resolve;
    });
    const signals: Array<{ signal: TerminalKillSignal; includeRootTree?: boolean }> = [];
    const processTreeKiller: ProcessTreeKiller = {
      capture: () => tree,
      inspect: () => ({
        verified: true,
        survivors: descendantsRunning ? tree.descendants : [],
      }),
      signal: ({ signal, includeRootTree }) => {
        signals.push({
          signal,
          ...(includeRootTree !== undefined ? { includeRootTree } : {}),
        });
        if (signal === "SIGTERM") resolveRootExit?.();
        if (signal === "SIGKILL") descendantsRunning = false;
      },
    };

    await expect(
      teardownProviderProcessTree(
        { rootPid: 201, rootExited, termGraceMs: 10, forceExitMs: 10, pollMs: 5 },
        { processTreeKiller, ...deterministicClock() },
      ),
    ).resolves.toEqual({ escalated: true, signalErrors: [] });
    expect(signals.at(-1)).toEqual({ signal: "SIGKILL", includeRootTree: false });
  });

  it("fails closed when forced termination cannot prove process-tree exit", async () => {
    const tree: CapturedProcessTree = {
      descendants: [{ pid: 302, command: "stuck-provider" }],
      captureComplete: true,
    };
    const failure = await teardownProviderProcessTree(
      { rootPid: 301, rootExited: new Promise(() => undefined), termGraceMs: 5, forceExitMs: 5 },
      {
        processTreeKiller: {
          capture: () => tree,
          inspect: () => ({ verified: true, survivors: tree.descendants }),
          signal: () => undefined,
        },
        ...deterministicClock(),
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderProcessExitUnprovenError);
    expect(failure).toMatchObject({
      rootPid: 301,
      rootExited: false,
      remainingDescendantPids: [302],
      safeToRetry: true,
    });
  });

  it("retries post-signal exit proof against the original captured tree", async () => {
    const tree: CapturedProcessTree = {
      descendants: [
        {
          pid: 352,
          command: "provider-worker",
          startTime: "Sun Jul 19 15:00:01 2026",
        },
      ],
      captureComplete: true,
    };
    const capture = vi.fn(() => tree);
    const signals: TerminalKillSignal[] = [];
    let inspectionAvailable = false;
    let resolveRootExit: (() => void) | undefined;
    const rootExited = new Promise<void>((resolve) => {
      resolveRootExit = resolve;
    });
    const processTreeKiller: ProcessTreeKiller = {
      capture,
      inspect: () =>
        inspectionAvailable
          ? { verified: true, survivors: [] }
          : { verified: false, survivors: [] },
      signal: ({ signal }) => {
        signals.push(signal);
        if (signal === "SIGTERM") resolveRootExit?.();
      },
    };

    const failure = await teardownProviderProcessTree(
      { rootPid: 351, rootExited, termGraceMs: 5, forceExitMs: 5 },
      { processTreeKiller, ...deterministicClock() },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderProcessExitUnprovenError);
    expect(failure).toMatchObject({ safeToRetry: true });
    expect((failure as ProviderProcessExitUnprovenError).retry).toBeTypeOf("function");

    inspectionAvailable = true;
    await expect((failure as ProviderProcessExitUnprovenError).retry?.()).resolves.toEqual({
      escalated: true,
      signalErrors: [],
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(signals).toEqual(["SIGTERM", "SIGKILL", "SIGKILL"]);
  });

  it("fails closed when the descendant capture was incomplete", async () => {
    const tree: CapturedProcessTree = { descendants: [], captureComplete: false };
    const signal = vi.fn();
    const failure = await teardownProviderProcessTree(
      {
        rootPid: 401,
        rootExited: new Promise(() => undefined),
        termGraceMs: 5,
        forceExitMs: 5,
      },
      {
        processTreeKiller: {
          capture: () => tree,
          inspect: () => ({ verified: true, survivors: [] }),
          signal,
        },
        ...deterministicClock(),
      },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "ProviderProcessExitUnprovenError",
      rootExited: false,
      captureComplete: false,
      safeToRetry: true,
    });
    expect(signal).not.toHaveBeenCalled();
  });

  it("does not treat a Windows root exit as descendant proof when taskkill failed", async () => {
    let resolveRootExit: (() => void) | undefined;
    const rootExited = new Promise<void>((resolve) => {
      resolveRootExit = resolve;
    });
    const processTreeKiller = createProcessTreeKiller({
      platform: "win32",
      signalWindowsTree: () => {
        resolveRootExit?.();
        return new Error("taskkill unavailable");
      },
    });

    const failure = await teardownProviderProcessTree(
      { rootPid: 451, rootExited, termGraceMs: 5, forceExitMs: 5 },
      { processTreeKiller, ...deterministicClock() },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "ProviderProcessExitUnprovenError",
      rootExited: true,
      remainingDescendantPids: null,
    });
  });
});
