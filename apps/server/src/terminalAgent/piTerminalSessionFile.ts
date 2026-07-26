import fs from "node:fs/promises";
import path from "node:path";

import { requireLaunchValue } from "./terminalAgentDriverFiles";

const PI_SESSION_HEADER_MAX_BYTES = 8 * 1024;

export function piTerminalSessionDir(stateDir: string): string {
  requireLaunchValue(stateDir, "State directory");
  return path.join(stateDir, "terminal-agent", "pi-sessions");
}

function isContainedPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

export async function validatePiTerminalSessionFile(input: {
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly sessionPath: string;
  readonly expectedSessionId?: string;
}): Promise<{ readonly path: string; readonly sessionId: string }> {
  requireLaunchValue(input.sessionPath, "Pi resume session path");
  if (!path.isAbsolute(input.sessionPath)) {
    throw new Error("Pi resume session path must be absolute.");
  }
  const sessionDir = piTerminalSessionDir(input.stateDir);
  const [canonicalSessionDir, canonicalWorkspaceRoot, candidateStat] = await Promise.all([
    fs.realpath(sessionDir),
    fs.realpath(input.workspaceRoot),
    fs.lstat(input.sessionPath),
  ]);
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new Error("Pi resume session path must be a regular file.");
  }
  const canonicalCandidate = await fs.realpath(input.sessionPath);
  if (!isContainedPath(canonicalSessionDir, canonicalCandidate)) {
    throw new Error("Pi resume session path is outside the managed session directory.");
  }
  const handle = await fs.open(canonicalCandidate, "r");
  let firstLine: string;
  try {
    const buffer = Buffer.alloc(PI_SESSION_HEADER_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0] ?? "";
  } finally {
    await handle.close();
  }
  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    throw new Error("Pi resume session file has an invalid header.");
  }
  const record = header && typeof header === "object" ? (header as Record<string, unknown>) : null;
  if (
    record?.type !== "session" ||
    typeof record.id !== "string" ||
    record.id.trim().length === 0 ||
    typeof record.cwd !== "string"
  ) {
    throw new Error("Pi resume session file has an invalid header.");
  }
  if (input.expectedSessionId !== undefined && record.id !== input.expectedSessionId) {
    throw new Error("Pi resume session id does not match the managed session.");
  }
  const canonicalSessionCwd = await fs.realpath(record.cwd);
  if (canonicalSessionCwd !== canonicalWorkspaceRoot) {
    throw new Error("Pi resume session belongs to a different workspace.");
  }
  return { path: canonicalCandidate, sessionId: record.id };
}
