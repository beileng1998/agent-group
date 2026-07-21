import path from "node:path";

import { describeErrorMessage } from "@agent-group/shared/errorMessages";
import {
  AGENT_GROUP_TERMINAL_CLI_KIND_ENV_KEY,
  terminalCliKindFromValue,
} from "@agent-group/shared/terminalThreads";
import { Effect } from "effect";

import type { PtyAdapterShape, PtyProcess } from "../../Services/PTY";
import type { ShellCandidate, TerminalSessionState } from "../../Services/Manager";
import {
  applyManagedTerminalAgentWrapperEnv,
  prepareManagedTerminalAgentWrappers,
} from "../../managedTerminalWrappers";
import type { TerminalManagerLogger } from "./terminalManagerContracts";

const WINDOWS_DEFAULT_TERMINAL_SHELL = "powershell.exe";
const MANAGED_TERMINAL_WRAPPER_DIRNAME = "_managed-bin";
const MANAGED_TERMINAL_ZSH_DIRNAME = "_managed-zsh";
const TERMINAL_SPAWN_TERM =
  globalThis.process.platform === "win32" ? "xterm-color" : "xterm-256color";
const TERMINAL_ENV_BLOCKLIST = new Set([
  "PORT",
  "ELECTRON_RENDERER_PORT",
  "ELECTRON_RUN_AS_NODE",
  "TERM",
  "TERMINFO",
  "TERMINFO_DIRS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "GHOSTTY_RESOURCES_DIR",
  "GHOSTTY_BIN_DIR",
  "ITERM_PROFILE",
  "ITERM_SESSION_ID",
  "KITTY_WINDOW_ID",
  "KITTY_PID",
  "KITTY_INSTALLATION_DIR",
  "WEZTERM_EXECUTABLE",
  "WEZTERM_CONFIG_FILE",
  "WEZTERM_PANE",
  "WEZTERM_UNIX_SOCKET",
  "ALACRITTY_SOCKET",
  "ALACRITTY_WINDOW_ID",
]);

type ShellResolutionOptions = {
  platform?: NodeJS.Platform;
  envShell?: string;
  envComSpec?: string;
};

export interface ManagedTerminalWrapperDirs {
  binDir: string | null;
  zshDir: string | null;
}

export function defaultShellResolver(): string {
  if (process.platform === "win32") return WINDOWS_DEFAULT_TERMINAL_SHELL;
  return process.env.SHELL ?? "bash";
}

function normalizeShellCommand(
  value: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (platform === "win32") return trimmed;
  const firstToken = trimmed.split(/\s+/g)[0]?.trim();
  return firstToken ? firstToken.replace(/^['"]|['"]$/g, "") : null;
}

function shellCandidateFromCommand(
  command: string | null,
  platform: NodeJS.Platform = process.platform,
): ShellCandidate | null {
  if (!command) return null;
  const shellName = path.basename(command).toLowerCase();
  if (platform !== "win32" && shellName === "zsh") {
    return { shell: command, args: ["-l", "-o", "nopromptsp"] };
  }
  return { shell: command };
}

export function formatShellCandidate(candidate: ShellCandidate): string {
  if (!candidate.args || candidate.args.length === 0) return candidate.shell;
  return `${candidate.shell} ${candidate.args.join(" ")}`;
}

function uniqueShellCandidates(candidates: Array<ShellCandidate | null>): ShellCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is ShellCandidate => {
    if (!candidate) return false;
    const key = formatShellCandidate(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveShellCandidates(
  shellResolver: () => string,
  options: ShellResolutionOptions = {},
): ShellCandidate[] {
  const platform = options.platform ?? process.platform;
  const requested = shellCandidateFromCommand(
    normalizeShellCommand(shellResolver(), platform),
    platform,
  );
  if (platform === "win32") {
    return uniqueShellCandidates([
      requested,
      shellCandidateFromCommand(options.envComSpec ?? process.env.ComSpec ?? null, platform),
      shellCandidateFromCommand(WINDOWS_DEFAULT_TERMINAL_SHELL, platform),
      shellCandidateFromCommand("cmd.exe", platform),
    ]);
  }
  return uniqueShellCandidates([
    requested,
    shellCandidateFromCommand(
      normalizeShellCommand(options.envShell ?? process.env.SHELL, platform),
      platform,
    ),
    shellCandidateFromCommand("/bin/zsh", platform),
    shellCandidateFromCommand("/bin/bash", platform),
    shellCandidateFromCommand("/bin/sh", platform),
    shellCandidateFromCommand("zsh", platform),
    shellCandidateFromCommand("bash", platform),
    shellCandidateFromCommand("sh", platform),
  ]);
}

export const __terminalManagerShellTesting = {
  resolveShellCandidates,
  windowsDefaultTerminalShell: WINDOWS_DEFAULT_TERMINAL_SHELL,
};

function isRetryableShellSpawnError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const messages: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "string") {
      messages.push(current);
    } else if (current instanceof Error) {
      messages.push(current.message);
      const cause = (current as { cause?: unknown }).cause;
      if (cause) queue.push(cause);
    } else if (typeof current === "object") {
      const value = current as { message?: unknown; cause?: unknown };
      if (typeof value.message === "string") messages.push(value.message);
      if (value.cause) queue.push(value.cause);
    }
  }
  const message = messages.join(" ").toLowerCase();
  return (
    message.includes("posix_spawnp failed") ||
    message.includes("enoent") ||
    message.includes("not found") ||
    message.includes("file not found") ||
    message.includes("no such file")
  );
}

function shouldExcludeTerminalEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return (
    normalizedKey.startsWith("AGENT_GROUP_") ||
    normalizedKey.startsWith("VITE_") ||
    TERMINAL_ENV_BLOCKLIST.has(normalizedKey)
  );
}

export function createTerminalSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtimeEnv?: Record<string, string> | null,
  managedWrapperOptions?: ManagedTerminalWrapperDirs,
): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && !shouldExcludeTerminalEnvKey(key)) spawnEnv[key] = value;
  }
  spawnEnv.TERM = TERMINAL_SPAWN_TERM;
  if (runtimeEnv) {
    for (const [key, value] of Object.entries(runtimeEnv)) spawnEnv[key] = value;
  }
  return managedWrapperOptions
    ? applyManagedTerminalAgentWrapperEnv(spawnEnv, managedWrapperOptions)
    : spawnEnv;
}

export function normalizedRuntimeEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!env || Object.keys(env).length === 0) return null;
  return Object.fromEntries(
    Object.entries(env).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

export function cliKindFromRuntimeEnv(runtimeEnv: Record<string, string> | null | undefined) {
  return terminalCliKindFromValue(runtimeEnv?.[AGENT_GROUP_TERMINAL_CLI_KIND_ENV_KEY]);
}

export function prepareManagedWrapperDirs(
  logsDir: string,
  logger: TerminalManagerLogger,
): ManagedTerminalWrapperDirs {
  if (process.platform === "win32") return { binDir: null, zshDir: null };
  const binDir = path.join(logsDir, MANAGED_TERMINAL_WRAPPER_DIRNAME);
  const zshDir = path.join(logsDir, MANAGED_TERMINAL_ZSH_DIRNAME);
  try {
    return prepareManagedTerminalAgentWrappers({ baseEnv: process.env, targetDir: binDir, zshDir });
  } catch (error) {
    logger.warn("failed to prepare managed terminal wrappers", {
      binDir,
      zshDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return { binDir: null, zshDir: null };
  }
}

export async function spawnTerminalProcess(input: {
  ptyAdapter: PtyAdapterShape;
  shellResolver: () => string;
  session: TerminalSessionState;
  wrappers: ManagedTerminalWrapperDirs;
}): Promise<{ process: PtyProcess; shellLabel: string }> {
  const candidates = resolveShellCandidates(input.shellResolver);
  const env = createTerminalSpawnEnv(process.env, input.session.runtimeEnv, input.wrappers);
  let lastSpawnError: unknown = null;
  for (const candidate of candidates) {
    try {
      const process = await Effect.runPromise(
        input.ptyAdapter.spawn({
          shell: candidate.shell,
          ...(candidate.args ? { args: candidate.args } : {}),
          cwd: input.session.cwd,
          cols: input.session.cols,
          rows: input.session.rows,
          env,
        }),
      );
      return { process, shellLabel: formatShellCandidate(candidate) };
    } catch (error) {
      lastSpawnError = error;
      if (!isRetryableShellSpawnError(error)) throw error;
    }
  }
  const detail = describeErrorMessage(lastSpawnError, "Terminal start failed");
  const tried =
    candidates.length > 0
      ? ` Tried shells: ${candidates.map(formatShellCandidate).join(", ")}.`
      : "";
  throw new Error(`${detail}.${tried}`.trim());
}
