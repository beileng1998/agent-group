import { describe, expect, it } from "vitest";

import {
  captureTerminalOwnerIdentity,
  inspectTerminalOwner,
  terminalOwnerIdentityMatches,
} from "./terminalProcessIdentity";

describe("terminal process identity", () => {
  it("captures a stable start identity and a non-reversible command fingerprint", () => {
    const identity = captureTerminalOwnerIdentity(42, {
      inspectProcess: (pid) => ({
        presence: "alive",
        identity: {
          pid,
          startTime: "Sat Jul 25 00:00:00 2026",
          command: "/usr/local/bin/codex resume session-1",
        },
      }),
    });

    expect(identity).toEqual({
      pid: 42,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(identity)).not.toContain("session-1");
  });

  it("distinguishes exact owners from PID reuse and command replacement", () => {
    const expected = {
      pid: 42,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "a".repeat(64),
    };
    expect(terminalOwnerIdentityMatches(expected, expected)).toBe(true);
    expect(
      terminalOwnerIdentityMatches(expected, {
        ...expected,
        startTime: "Sat Jul 25 01:00:00 2026",
      }),
    ).toBe(false);
    expect(
      terminalOwnerIdentityMatches(expected, {
        ...expected,
        commandFingerprint: "b".repeat(64),
      }),
    ).toBe(false);
  });

  it("never converts an unavailable process-table identity into an owner match", () => {
    expect(
      inspectTerminalOwner(42, {
        platform: "win32",
        inspectProcess: () => ({
          presence: "unverified",
          detail: "PowerShell unavailable",
        }),
      }),
    ).toEqual({
      presence: "unverified",
      detail: "PowerShell unavailable",
    });
    expect(() =>
      captureTerminalOwnerIdentity(42, {
        inspectProcess: () => ({ presence: "absent" }),
      }),
    ).toThrow("exited");
  });
});
