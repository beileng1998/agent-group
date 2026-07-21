import { lstat, mkdir, realpath, stat } from "node:fs/promises";

const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type PathState = "missing" | "symlink" | "directory" | "file" | "other";

export function isAgentGroupEntityId(id: string): boolean {
  return ENTITY_ID.test(id) && id !== "__proto__" && id !== "constructor" && id !== "prototype";
}

export function assertAgentGroupEntityId(id: string, label = "id"): void {
  if (!isAgentGroupEntityId(id)) throw new Error(`Invalid ${label}`);
}

export async function canonicalDirectory(input: string): Promise<string> {
  const canonical = await realpath(input);
  if (!(await stat(canonical)).isDirectory()) throw new Error("Workspace root must be a directory");
  return canonical;
}

export async function existingPathState(candidate: string): Promise<PathState> {
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "other";
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return "missing";
    throw error;
  }
}

export async function ensureRealDirectory(
  directory: string,
  symlinkMessage = `Path must not be a symlink: ${directory}`,
): Promise<void> {
  const state = await existingPathState(directory);
  if (state === "symlink") throw new Error(symlinkMessage);
  if (state !== "missing" && state !== "directory") {
    throw new Error(`${directory} must be a directory`);
  }
  if (state === "missing") await mkdir(directory, { recursive: false, mode: 0o700 });
}

export function createCanonicalDirectoryQueue() {
  const queues = new Map<string, Promise<void>>();
  return async function withLock<T>(
    workspaceRoot: string,
    operation: (canonicalWorkspaceRoot: string) => Promise<T>,
  ): Promise<T> {
    const canonicalWorkspaceRoot = await canonicalDirectory(workspaceRoot);
    const previous = queues.get(canonicalWorkspaceRoot) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => operation(canonicalWorkspaceRoot));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(canonicalWorkspaceRoot, tail);
    try {
      return await result;
    } finally {
      if (queues.get(canonicalWorkspaceRoot) === tail) queues.delete(canonicalWorkspaceRoot);
    }
  };
}

export function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
