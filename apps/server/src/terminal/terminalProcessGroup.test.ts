import { describe, expect, it, vi } from "vitest";

import {
  makeTerminalProcessGroupController,
  parseProcessGroupTable,
} from "./terminalProcessGroup";

const leaderLine =
  " 42001 42001 S Sat Jul 25 00:00:00 2026 /bin/sh -c managed-agent";
const childLine =
  " 42002 42001 S Sat Jul 25 00:00:01 2026 /bin/sleep 300";

describe("terminal POSIX process-group ownership", () => {
  it("captures a stable leader only when the PTY root owns its group", () => {
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => `${leaderLine}\n${childLine}\n`,
      signalGroup: () => null,
    });

    const identity = controller.capture(42_001);

    expect(identity).toMatchObject({
      pgid: 42_001,
      leaderIdentity: {
        pid: 42_001,
        startTime: "Sat Jul 25 00:00:00 2026",
      },
    });
    expect(identity?.leaderIdentity.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parseProcessGroupTable(`${leaderLine}\n${childLine}`)).toHaveLength(2);
  });

  it("continues to own the reserved group after its leader exits", () => {
    let table = `${leaderLine}\n${childLine}\n`;
    const signalled = vi.fn(() => {
      table = "";
      return null;
    });
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => table,
      signalGroup: signalled,
    });
    const identity = controller.capture(42_001)!;
    table = `${childLine}\n`;

    expect(controller.inspect(identity)).toEqual({
      status: "owned",
      detail: null,
    });
    expect(controller.signal(identity, "SIGKILL")).toBeNull();
    expect(signalled).toHaveBeenCalledWith(42_001, "SIGKILL");
    expect(controller.inspect(identity)).toEqual({
      status: "absent",
      detail: null,
    });
  });

  it("never signals a reused PID/process-group identity", () => {
    let table = `${leaderLine}\n`;
    const signalGroup = vi.fn(() => null);
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => table,
      signalGroup,
    });
    const identity = controller.capture(42_001)!;
    table =
      " 42001 42001 S Sat Jul 25 01:00:00 2026 /usr/bin/unrelated-service\n";

    expect(controller.inspect(identity)).toEqual({
      status: "replaced",
      detail: null,
    });
    expect(controller.signal(identity, "SIGKILL")).toBeNull();
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("fails closed when a leader command changes without a new start identity", () => {
    let table = `${leaderLine}\n`;
    const signalGroup = vi.fn(() => null);
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => table,
      signalGroup,
    });
    const identity = controller.capture(42_001)!;
    table =
      " 42001 42001 S Sat Jul 25 00:00:00 2026 /usr/bin/exec-replacement\n";

    expect(controller.inspect(identity)).toMatchObject({
      status: "unverified",
      detail: expect.stringContaining("changed command"),
    });
    expect(controller.signal(identity, "SIGKILL")).toBeInstanceOf(Error);
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("treats a fully exited zombie-only group as non-executable", () => {
    let table = `${leaderLine}\n`;
    const signalGroup = vi.fn(() => null);
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => table,
      signalGroup,
    });
    const identity = controller.capture(42_001)!;
    table =
      " 42001 42001 Z Sat Jul 25 00:00:00 2026 /bin/sh <defunct>\n";

    expect(controller.inspect(identity)).toEqual({
      status: "absent",
      detail: null,
    });
    expect(controller.signal(identity, "SIGKILL")).toBeNull();
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("fails closed when ownership cannot be inspected", () => {
    const controller = makeTerminalProcessGroupController({
      platform: "darwin",
      readProcessTable: () => null,
      signalGroup: vi.fn(() => null),
    });
    const identity = {
      pgid: 42_001,
      leaderIdentity: {
        pid: 42_001,
        startTime: "Sat Jul 25 00:00:00 2026",
        commandFingerprint: "0".repeat(64),
      },
    };

    expect(controller.inspect(identity)).toMatchObject({
      status: "unverified",
    });
    expect(controller.signal(identity, "SIGKILL")).toBeInstanceOf(Error);
  });

  it("never sends a POSIX group signal on Windows", () => {
    const signalGroup = vi.fn(() => null);
    const controller = makeTerminalProcessGroupController({
      platform: "win32",
      readProcessTable: () => `${leaderLine}\n`,
      signalGroup,
    });
    const identity = {
      pgid: 42_001,
      leaderIdentity: {
        pid: 42_001,
        startTime: "Sat Jul 25 00:00:00 2026",
        commandFingerprint: "0".repeat(64),
      },
    };

    expect(controller.signal(identity, "SIGKILL")).toBeInstanceOf(Error);
    expect(signalGroup).not.toHaveBeenCalled();
  });
});
