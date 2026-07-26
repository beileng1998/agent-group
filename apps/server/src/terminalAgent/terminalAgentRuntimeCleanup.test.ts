import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  retireTerminalContextFile,
  retireTerminalRuntimeDirectory,
} from "./terminalAgentRuntimeCleanup";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("managed terminal runtime cleanup", () => {
  it("removes only private context files and managed runtime directories", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-cleanup-"));
    directories.push(stateDir);
    const runtimeDir = path.join(stateDir, "terminal-agent", "pi", "runtime-1");
    const contextPath = path.join(runtimeDir, "context", "turn.md");
    await fs.mkdir(path.dirname(contextPath), { recursive: true });
    await fs.writeFile(contextPath, "private context");

    await retireTerminalContextFile(runtimeDir, contextPath);
    await expect(fs.lstat(contextPath)).rejects.toMatchObject({ code: "ENOENT" });
    await retireTerminalRuntimeDirectory(stateDir, runtimeDir);
    await expect(fs.lstat(runtimeDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects cleanup targets outside the managed runtime", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-cleanup-"));
    directories.push(stateDir);
    const outside = path.join(stateDir, "keep.txt");
    await fs.writeFile(outside, "keep");

    await expect(retireTerminalRuntimeDirectory(stateDir, outside)).rejects.toThrow("outside");
    await expect(fs.readFile(outside, "utf8")).resolves.toBe("keep");
  });
});
