import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const TERMINAL_ENV_BLOCKLIST = new Set([
  "ELECTRON_RUN_AS_NODE",
  "PORT",
  "TERM",
  "TERMINFO",
  "TERMINFO_DIRS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
]);

function keepBaseEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    !normalized.startsWith("AGENT_GROUP_") &&
    !normalized.startsWith("VITE_") &&
    !TERMINAL_ENV_BLOCKLIST.has(normalized)
  );
}

export function buildTerminalAgentProcessEnv(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string" && keepBaseEnvironmentKey(key)) {
      env[key] = value;
    }
  }
  env.TERM = process.platform === "win32" ? "xterm-color" : "xterm-256color";
  return { ...env, ...overrides };
}

export function requireLaunchValue(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value;
}

export function requireRuntimeId(value: string): string {
  requireLaunchValue(value, "Runtime instance id");
  if (
    value.length > 128 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/u.test(value)
  ) {
    throw new Error("Runtime instance id is invalid.");
  }
  return value;
}

export async function ensurePrivateDirectory(
  directory: string,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Private runtime path is not a directory: ${directory}`);
  }
  await fs.chmod(directory, 0o700);
}

export async function writePrivateFile(
  filePath: string,
  content: string,
  mode: 0o600 | 0o700,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, content, {
      flag: "wx",
      mode,
    });
    await fs.chmod(temporaryPath, mode);
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, mode);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}
