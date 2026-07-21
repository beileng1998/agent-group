import { readdir } from "node:fs/promises";
import path from "node:path";

import { resolveCodexHomeAllowlistCandidates } from "../codexHomePaths.ts";

async function safeReadDir(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findFile(
  directory: string,
  matches: (name: string) => boolean,
  remainingDepth: number,
): Promise<string | null> {
  const entries = (await safeReadDir(directory)).toSorted((left, right) =>
    right.name.localeCompare(left.name),
  );
  for (const entry of entries) {
    if (entry.isFile() && matches(entry.name)) {
      return path.join(directory, entry.name);
    }
    if (remainingDepth > 0 && entry.isDirectory()) {
      const nested = await findFile(path.join(directory, entry.name), matches, remainingDepth - 1);
      if (nested) return nested;
    }
  }
  return null;
}

export async function findCodexTranscriptPath(input: {
  readonly homePath?: string;
  readonly providerThreadId: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const providerThreadId = input.providerThreadId.trim();
  if (!/^[0-9a-f-]+$/iu.test(providerThreadId)) return null;

  const homes = resolveCodexHomeAllowlistCandidates({
    ...(input.env ? { env: input.env } : {}),
    ...(input.homePath ? { homePath: input.homePath } : {}),
  });
  for (const home of homes) {
    const match = await findFile(
      path.join(home, "sessions"),
      (name) => name === `${providerThreadId}.jsonl` || name.endsWith(`-${providerThreadId}.jsonl`),
      3,
    );
    if (match) return match;
  }
  return null;
}

export async function findClaudeTranscriptPath(input: {
  readonly homeDir: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const sessionId = input.sessionId.trim();
  if (!/^[0-9a-f-]+$/iu.test(sessionId)) return null;

  const env = input.env ?? process.env;
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(input.homeDir, ".claude");
  const projectsRoot = path.join(configDir, "projects");
  for (const project of await safeReadDir(projectsRoot)) {
    if (!project.isDirectory()) continue;
    const projectDirectory = path.join(projectsRoot, project.name);
    const transcript = (await safeReadDir(projectDirectory)).find(
      (entry) => entry.isFile() && entry.name === `${sessionId}.jsonl`,
    );
    if (transcript) return path.join(projectDirectory, transcript.name);
  }
  return null;
}
