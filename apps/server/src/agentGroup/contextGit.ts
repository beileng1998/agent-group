import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  assertAgentGroupEntityId,
  createCanonicalDirectoryQueue,
  ensureRealDirectory,
  existingPathState,
  isAgentGroupEntityId,
  isNodeError,
} from "./filesystem";

const execFileAsync = promisify(execFile);

const COMMIT_ID = /^[0-9a-fA-F]{40,64}$/;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const BOOTSTRAP_COMPLETE_CONFIG = "agent-group.contextBootstrapComplete";
const INTERNAL_EXCLUDES = ["state.json", "state.json.*.tmp", "sessions/*/attachments/"] as const;
const OUTER_EXCLUDE = ".agent-group/";

const withWorkdirLock = createCanonicalDirectoryQueue();
const initializedRepositories = new Set<string>();

export interface ContextRepositoryState {
  readonly repositoryPath: string;
  readonly head: string;
}

export interface ContextAwareness {
  readonly base: string;
  readonly head: string;
  readonly command: string;
}

export interface PreparedSessionContext {
  readonly awareness: ContextAwareness | null;
}

export async function ensureContextRepository(
  workspaceRoot: string,
): Promise<ContextRepositoryState> {
  return withWorkdirLock(workspaceRoot, ensureRepositoryUnlocked);
}

export async function commitSessionContext(
  workspaceRoot: string,
  sessionId: string,
  reason = `Update context for ${sessionId}`,
): Promise<string | null> {
  assertEntityId(sessionId, "session id");
  return withWorkdirLock(workspaceRoot, async (canonicalWorkdir) => {
    const repository = await ensureRepositoryUnlocked(canonicalWorkdir);
    return commitSessionContextUnlocked(repository.repositoryPath, sessionId, reason);
  });
}

export async function prepareSessionContext(
  workspaceRoot: string,
  sessionId: string,
  awarenessEnabled: boolean,
  lastSeenCommit: string | null,
): Promise<PreparedSessionContext> {
  assertEntityId(sessionId, "session id");
  return withWorkdirLock(workspaceRoot, async (canonicalWorkdir) => {
    const repository = await ensureRepositoryUnlocked(canonicalWorkdir);
    await commitSessionContextUnlocked(
      repository.repositoryPath,
      sessionId,
      `Update context for ${sessionId}`,
    );
    return {
      awareness: awarenessEnabled
        ? await prepareContextAwarenessUnlocked(repository.repositoryPath, lastSeenCommit)
        : null,
    };
  });
}

async function commitSessionContextUnlocked(
  repositoryPath: string,
  sessionId: string,
  reason: string,
): Promise<string | null> {
  const relativePath = path.posix.join("sessions", sessionId, "context.md");
  await git(repositoryPath, ["add", "-A", "--", relativePath]);
  if (await gitIsQuiet(repositoryPath, ["diff", "--cached", "--quiet", "--", relativePath])) {
    return null;
  }
  await git(repositoryPath, [
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--no-gpg-sign",
    "--no-verify",
    "--only",
    "-m",
    reason,
    "--",
    relativePath,
  ]);
  return gitOutput(repositoryPath, ["rev-parse", "HEAD"]);
}

async function prepareContextAwarenessUnlocked(
  repositoryPath: string,
  lastSeenCommit: string | null,
): Promise<ContextAwareness> {
  const head = await gitOutput(repositoryPath, ["rev-parse", "HEAD"]);
  const root = await rootCommit(repositoryPath);
  const base = (await validAncestor(repositoryPath, lastSeenCommit, head)) ?? root;
  return {
    base,
    head,
    command: `git -C .agent-group diff ${base}..${head} -- 'sessions/*/context.md'`,
  };
}

async function ensureRepositoryUnlocked(canonicalWorkdir: string): Promise<ContextRepositoryState> {
  const repositoryPath = path.join(canonicalWorkdir, ".agent-group");
  await ensureRealDirectory(repositoryPath, ".agent-group must not be a symlink");

  const gitDirectory = path.join(repositoryPath, ".git");
  const gitState = await existingPathState(gitDirectory);
  if (gitState === "symlink") throw new Error(".agent-group/.git must not be a symlink");
  if (gitState !== "missing" && gitState !== "directory") {
    throw new Error(".agent-group/.git must be a directory");
  }
  if (gitState === "directory" && initializedRepositories.has(repositoryPath)) {
    try {
      await ensureOuterRepositoryExclude(canonicalWorkdir);
      return {
        repositoryPath,
        head: await gitOutput(repositoryPath, ["rev-parse", "HEAD"]),
      };
    } catch {
      initializedRepositories.delete(repositoryPath);
    }
  }
  if (gitState === "missing") {
    initializedRepositories.delete(repositoryPath);
    await git(repositoryPath, ["init", "--quiet"]);
  }

  const initializedGitState = await existingPathState(gitDirectory);
  if (initializedGitState === "symlink") {
    throw new Error(".agent-group/.git must not be a symlink");
  }
  if (initializedGitState !== "directory") throw new Error("Failed to initialize context Git");

  await assertRepositoryRoot(repositoryPath);
  await ensureOuterRepositoryExclude(canonicalWorkdir);
  await git(repositoryPath, ["config", "--local", "user.name", "Agent Group"]);
  await git(repositoryPath, ["config", "--local", "user.email", "agent-group@localhost"]);
  await ensureInternalExcludes(repositoryPath);

  if (!(await hasHead(repositoryPath))) {
    await git(repositoryPath, ["read-tree", "--empty"]);
    await git(repositoryPath, [
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "--no-verify",
      "-m",
      "Initialize context history",
    ]);
  }

  if (!(await bootstrapCompleted(repositoryPath))) {
    if (!(await headTracksContext(repositoryPath))) await bootstrapExistingContexts(repositoryPath);
    await git(repositoryPath, ["config", "--local", BOOTSTRAP_COMPLETE_CONFIG, "true"]);
  }

  initializedRepositories.add(repositoryPath);
  return {
    repositoryPath,
    head: await gitOutput(repositoryPath, ["rev-parse", "HEAD"]),
  };
}

async function ensureOuterRepositoryExclude(canonicalWorkdir: string): Promise<void> {
  let excludePath: string;
  try {
    const resolved = await gitOutput(canonicalWorkdir, ["rev-parse", "--git-path", "info/exclude"]);
    excludePath = path.isAbsolute(resolved) ? resolved : path.resolve(canonicalWorkdir, resolved);
  } catch {
    return;
  }

  const infoDirectory = path.dirname(excludePath);
  const directoryState = await existingPathState(infoDirectory);
  if (directoryState === "symlink")
    throw new Error("Outer Git info directory must not be a symlink");
  if (directoryState !== "missing" && directoryState !== "directory") {
    throw new Error("Outer Git info path must be a directory");
  }
  if (directoryState === "missing") await mkdir(infoDirectory, { recursive: true, mode: 0o700 });

  const state = await existingPathState(excludePath);
  if (state !== "missing" && state !== "file") {
    throw new Error("Outer Git exclude must be a regular file");
  }
  const content = state === "missing" ? "" : await readFile(excludePath, "utf8");
  if (content.split(/\r?\n/).includes(OUTER_EXCLUDE)) return;
  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await appendFile(excludePath, `${prefix}${OUTER_EXCLUDE}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function ensureInternalExcludes(repositoryPath: string): Promise<void> {
  const infoDirectory = path.join(repositoryPath, ".git", "info");
  const excludePath = path.join(infoDirectory, "exclude");
  const infoState = await existingPathState(infoDirectory);
  if (infoState === "symlink") throw new Error("Context Git info directory must not be a symlink");
  if (infoState !== "missing" && infoState !== "directory") {
    throw new Error("Context Git info path must be a directory");
  }
  if (infoState === "missing") await mkdir(infoDirectory, { recursive: false, mode: 0o700 });
  const state = await existingPathState(excludePath);
  if (state !== "missing" && state !== "file") {
    throw new Error("Context Git exclude must be a regular file");
  }
  let content = state === "missing" ? "" : await readFile(excludePath, "utf8");
  for (const pattern of INTERNAL_EXCLUDES) {
    if (content.split(/\r?\n/).includes(pattern)) continue;
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    const addition = `${prefix}${pattern}\n`;
    await appendFile(excludePath, addition, { encoding: "utf8", mode: 0o600 });
    content += addition;
  }
}

async function bootstrapCompleted(repositoryPath: string): Promise<boolean> {
  return gitIsQuiet(repositoryPath, ["config", "--local", "--get", BOOTSTRAP_COMPLETE_CONFIG]);
}

async function headTracksContext(repositoryPath: string): Promise<boolean> {
  const tracked = await gitOutput(repositoryPath, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    "sessions",
  ]);
  return tracked.split(/\s+/).some((entry) => /^sessions\/[^/]+\/context\.md$/.test(entry));
}

async function bootstrapExistingContexts(repositoryPath: string): Promise<void> {
  const contextPaths = await existingContextPaths(repositoryPath);
  if (contextPaths.length === 0) return;
  await git(repositoryPath, ["add", "--", ...contextPaths]);
  await git(repositoryPath, [
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--no-gpg-sign",
    "--no-verify",
    "-m",
    "Bootstrap existing contexts",
  ]);
}

async function existingContextPaths(repositoryPath: string): Promise<string[]> {
  const sessionsPath = path.join(repositoryPath, "sessions");
  let entries;
  try {
    entries = await readdir(sessionsPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isAgentGroupEntityId(entry.name)) continue;
    const relativePath = path.posix.join("sessions", entry.name, "context.md");
    if ((await existingPathState(path.join(repositoryPath, relativePath))) === "file") {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}

async function assertRepositoryRoot(repositoryPath: string): Promise<void> {
  const topLevel = await gitOutput(repositoryPath, ["rev-parse", "--show-toplevel"]);
  const [actual, expected] = await Promise.all([realpath(topLevel), realpath(repositoryPath)]);
  if (actual !== expected) throw new Error("Context Git root must be .agent-group");
}

async function rootCommit(repositoryPath: string): Promise<string> {
  const roots = (
    await gitOutput(repositoryPath, ["rev-list", "--reverse", "--max-parents=0", "HEAD"])
  )
    .split(/\s+/)
    .filter(Boolean);
  if (!roots[0]) throw new Error("Context Git has no root commit");
  return roots[0];
}

async function validAncestor(
  repositoryPath: string,
  candidate: string | null,
  head: string,
): Promise<string | null> {
  if (!candidate || !COMMIT_ID.test(candidate)) return null;
  let resolved: string;
  try {
    resolved = await gitOutput(repositoryPath, ["rev-parse", "--verify", `${candidate}^{commit}`]);
  } catch {
    return null;
  }
  return (await gitIsQuiet(repositoryPath, ["merge-base", "--is-ancestor", resolved, head]))
    ? resolved
    : null;
}

async function hasHead(repositoryPath: string): Promise<boolean> {
  return gitIsQuiet(repositoryPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
}

async function gitOutput(repositoryPath: string, args: string[]): Promise<string> {
  return (await git(repositoryPath, args)).trim();
}

async function gitIsQuiet(repositoryPath: string, args: string[]): Promise<boolean> {
  try {
    await git(repositoryPath, args);
    return true;
  } catch (error) {
    if (isExecError(error) && error.code === 1) return false;
    throw error;
  }
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
  ]) {
    delete env[name];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  const { stdout } = await execFileAsync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    env,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
  });
  return stdout;
}

function assertEntityId(id: string, label: string): void {
  assertAgentGroupEntityId(id, label);
}

function isExecError(error: unknown): error is Error & { code: number } {
  return error instanceof Error && "code" in error && typeof error.code === "number";
}
