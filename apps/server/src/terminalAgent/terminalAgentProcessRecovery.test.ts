import { describe, expect, it, vi } from "vitest";

import type { TerminalProcessGroupController } from "../terminal/terminalProcessGroup";
import {
  inspectTerminalProcess,
  waitForPersistedTerminalOwnerExit,
  type TerminalProcessInspection,
} from "./terminalAgentProcessRecovery";

const identity = {
  pid: 42,
  startTime: "Sat Jul 25 00:00:00 2026",
  commandFingerprint: "0".repeat(64),
} as const;
const processGroupIdentity = {
  pgid: 42,
  leaderIdentity: identity,
} as const;

describe("persisted terminal process recovery", () => {
  it("does not infer descendant exit from a legacy root disappearing", async () => {
    const inspections: TerminalProcessInspection[] = [
      { presence: "alive", detail: null },
      { presence: "alive", detail: null },
      { presence: "absent", detail: null },
    ];
    const sleep = vi.fn(async () => {});

    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        inspect: () => ({
          ...inspections.shift()!,
          identity,
        }),
        maxWaitMs: 50,
        pollMs: 25,
        sleep,
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("no process-group identity"),
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails closed while any process still occupies the persisted PID", async () => {
    const inspect = vi.fn(
      (): TerminalProcessInspection => ({
        presence: "alive",
        detail: null,
        identity,
      }),
    );

    const result = await waitForPersistedTerminalOwnerExit({
      pid: 42,
      ownerIdentity: identity,
      inspect,
      maxWaitMs: 50,
      pollMs: 25,
      sleep: async () => {},
    });

    expect(result).toMatchObject({
      verified: false,
      detail: expect.stringContaining("Refusing to spawn"),
    });
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("does not treat permission or inspection failures as proof of exit", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        inspect: () => ({ presence: "unverified", detail: "permission denied" }),
      }),
    ).resolves.toEqual({
      verified: false,
      detail: "permission denied",
    });
    expect(inspectTerminalProcess(0)).toMatchObject({
      presence: "unverified",
    });
  });

  it("does not infer descendant exit from legacy PID reuse", async () => {
    const inspect = vi.fn(
      (): TerminalProcessInspection => ({
        presence: "alive",
        detail: null,
        identity: {
          ...identity,
          startTime: "Sat Jul 25 01:00:00 2026",
        },
      }),
    );

    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        inspect,
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("was reused"),
    });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("fails closed when only the command fingerprint changes", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        inspect: () => ({
          presence: "alive",
          detail: null,
          identity: {
            ...identity,
            commandFingerprint: "f".repeat(64),
          },
        }),
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("changed command"),
    });
  });

  it("fails closed for a live legacy PID without a persisted identity", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: null,
        inspect: () => ({
          presence: "alive",
          detail: null,
          identity,
        }),
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("legacy record"),
    });
  });

  it("fails closed for an absent legacy PID with unknown descendants", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: null,
        inspect: () => ({ presence: "absent", detail: null }),
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("no process-group identity"),
    });
  });

  it("fails closed across the pre-persistence POSIX spawn crash window", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: null,
        ownerIdentity: null,
        platform: "darwin",
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("no persisted PID or process-group identity"),
    });
  });

  it("fails closed for an unidentifiable pre-persistence Windows owner", async () => {
    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: null,
        ownerIdentity: null,
        platform: "win32",
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("no persisted PID or process-group identity"),
    });
  });

  it("kills and rechecks an owned persisted POSIX process group", async () => {
    const statuses: Array<"owned" | "absent"> = ["owned", "owned", "absent"];
    const signal = vi.fn(() => null);
    const controller: TerminalProcessGroupController = {
      capture: () => processGroupIdentity,
      inspect: () => ({
        status: statuses.shift() ?? "absent",
        detail: null,
      }),
      signal,
    };

    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        processGroupIdentity,
        processGroupController: controller,
        maxWaitMs: 50,
        pollMs: 25,
        sleep: async () => {},
        platform: "darwin",
      }),
    ).resolves.toEqual({ verified: true, detail: null });
    expect(signal).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith(processGroupIdentity, "SIGKILL");
  });

  it("does not signal a process group whose leader identity was reused", async () => {
    const signal = vi.fn(() => null);
    const controller: TerminalProcessGroupController = {
      capture: () => processGroupIdentity,
      inspect: () => ({ status: "replaced", detail: null }),
      signal,
    };

    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        processGroupIdentity,
        processGroupController: controller,
        platform: "darwin",
      }),
    ).resolves.toEqual({ verified: true, detail: null });
    expect(signal).not.toHaveBeenCalled();
  });

  it("never signals a persisted POSIX process group on Windows", async () => {
    const signal = vi.fn(() => null);
    const controller: TerminalProcessGroupController = {
      capture: () => processGroupIdentity,
      inspect: () => ({ status: "owned", detail: null }),
      signal,
    };

    await expect(
      waitForPersistedTerminalOwnerExit({
        pid: 42,
        ownerIdentity: identity,
        processGroupIdentity,
        processGroupController: controller,
        platform: "win32",
      }),
    ).resolves.toMatchObject({
      verified: false,
      detail: expect.stringContaining("cannot be safely terminated on Windows"),
    });
    expect(signal).not.toHaveBeenCalled();
  });
});
