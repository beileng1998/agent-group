import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ProjectId, ThreadId } from "@agent-group/contracts";
import { afterEach } from "vitest";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

export function sessionRef(workspaceRoot: string, sessionId: string, parentSessionId?: string) {
  return {
    workspaceRoot,
    groupId: ProjectId.makeUnsafe("group-one"),
    sessionId: ThreadId.makeUnsafe(sessionId),
    ...(parentSessionId ? { parentSessionId: ThreadId.makeUnsafe(parentSessionId) } : {}),
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

export async function temporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-group-"));
  const canonical = await realpath(directory);
  cleanup.push(canonical);
  return canonical;
}

export async function git(workspaceRoot: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", path.join(workspaceRoot, ".agent-group"), ...args],
    { encoding: "utf8", shell: false },
  );
  return stdout.trim();
}

export async function fileExists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
