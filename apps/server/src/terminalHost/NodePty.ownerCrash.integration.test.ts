import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultTerminalProcessGroupController } from "../terminal/terminalProcessGroup";
import { waitForPersistedTerminalOwnerExit } from "../terminalAgent/terminalAgentProcessRecovery";

const directories: string[] = [];
const holders: ChildProcess[] = [];

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processIsAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ESRCH";
  }
}

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL");
  }
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("node-pty owner crash", () => {
  it("hangs up the PTY root when the server-side holder is SIGKILLed", async () => {
    if (process.platform === "win32") return;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-group-pty-owner-crash-"),
    );
    directories.push(directory);
    const pidPath = path.join(directory, "pty.pid");
    const holderScript = [
      'const fs = require("node:fs");',
      'const pty = require("node-pty");',
      'const terminal = pty.spawn("/bin/sleep", ["300"], {',
      '  cwd: process.cwd(), cols: 80, rows: 24, env: process.env, name: "xterm-256color"',
      "});",
      `fs.writeFileSync(${JSON.stringify(pidPath)}, String(terminal.pid));`,
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const holder = spawn(process.execPath, ["-e", holderScript], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    holders.push(holder);
    let holderError = "";
    holder.stderr?.on("data", (chunk) => {
      holderError += String(chunk);
    });

    await waitFor(() => fs.stat(pidPath).then(() => true, () => false));
    const ptyPid = Number(await fs.readFile(pidPath, "utf8"));
    expect(ptyPid).toBeGreaterThan(0);
    expect(processIsAbsent(ptyPid)).toBe(false);

    expect(holder.kill("SIGKILL")).toBe(true);
    await waitFor(() => processIsAbsent(ptyPid), 5_000).catch((cause) => {
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}; holder stderr: ${holderError}`,
      );
    });
  });

  it("reaps a HUP-ignoring child from durable process-group ownership", async () => {
    if (process.platform === "win32") return;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-group-pty-group-crash-"),
    );
    directories.push(directory);
    const rootPidPath = path.join(directory, "root.pid");
    const childPidPath = path.join(directory, "child.pid");
    const command = [
      "(trap '' HUP; exec sleep 300) &",
      "child=$!",
      `echo \"$child\" > ${JSON.stringify(childPidPath)}`,
      "wait",
    ].join("\n");
    const holderScript = [
      'const fs = require("node:fs");',
      'const pty = require("node-pty");',
      `const terminal = pty.spawn("/bin/sh", ["-c", ${JSON.stringify(command)}], {`,
      '  cwd: process.cwd(), cols: 80, rows: 24, env: process.env, name: "xterm-256color"',
      "});",
      `fs.writeFileSync(${JSON.stringify(rootPidPath)}, String(terminal.pid));`,
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const holder = spawn(process.execPath, ["-e", holderScript], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    holders.push(holder);
    let childPid: number | null = null;
    let processGroup =
      null as ReturnType<typeof defaultTerminalProcessGroupController.capture>;
    try {
      await waitFor(() =>
        Promise.all([
          fs.stat(rootPidPath),
          fs.stat(childPidPath),
        ]).then(() => true, () => false),
      );
      const rootPid = Number(await fs.readFile(rootPidPath, "utf8"));
      childPid = Number(await fs.readFile(childPidPath, "utf8"));
      processGroup = defaultTerminalProcessGroupController.capture(rootPid);
      expect(processGroup).not.toBeNull();
      expect(processGroup?.pgid).toBe(rootPid);
      expect(processIsAbsent(childPid)).toBe(false);

      expect(holder.kill("SIGKILL")).toBe(true);
      await waitFor(() => processIsAbsent(rootPid));
      expect(processIsAbsent(childPid)).toBe(false);

      await expect(
        waitForPersistedTerminalOwnerExit({
          pid: rootPid,
          ownerIdentity: processGroup!.leaderIdentity,
          processGroupIdentity: processGroup,
          maxWaitMs: 2_000,
          pollMs: 20,
          platform: process.platform,
        }),
      ).resolves.toEqual({ verified: true, detail: null });
      await waitFor(() => processIsAbsent(childPid!));
    } finally {
      if (processGroup !== null) {
        defaultTerminalProcessGroupController.signal(processGroup, "SIGKILL");
      }
      if (childPid !== null && !processIsAbsent(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // Recovery won the cleanup race.
        }
      }
    }
  });
});
