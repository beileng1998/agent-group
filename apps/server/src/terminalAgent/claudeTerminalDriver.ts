import path from "node:path";

import type { ClaudeModelSelection, RuntimeMode } from "@agent-group/contracts";

import { buildClaudeProcessEnv } from "../provider/claudeProcessEnv";
import { buildClaudeHookShimSource } from "./claudeHookShim";
import {
  buildTerminalAgentProcessEnv,
  ensurePrivateDirectory,
  requireLaunchValue,
  requireRuntimeId,
  writePrivateFile,
} from "./terminalAgentDriverFiles";
import type { TerminalAgentDriverLaunch } from "./terminalAgentProtocol";

export const CLAUDE_HOOK_ENDPOINT_ENV = "AGENT_GROUP_HOOK_ENDPOINT";
export const CLAUDE_HOOK_TOKEN_ENV = "AGENT_GROUP_HOOK_TOKEN";
export const CLAUDE_RUNTIME_INSTANCE_ID_ENV = "AGENT_GROUP_RUNTIME_INSTANCE_ID";
export const CLAUDE_HOOK_SPOOL_DIR_ENV = "AGENT_GROUP_HOOK_SPOOL_DIR";
export const CLAUDE_DISABLE_AUTOUPDATER_ENV = "DISABLE_AUTOUPDATER";

export interface ClaudeTerminalLaunch extends TerminalAgentDriverLaunch {
  readonly settingsPath: string;
  readonly shimPath: string;
}

export function claudeTerminalRuntimeDir(stateDir: string, runtimeInstanceId: string): string {
  requireLaunchValue(stateDir, "State directory");
  requireRuntimeId(runtimeInstanceId);
  return path.join(stateDir, "terminal-agent", "claude", runtimeInstanceId);
}

export function claudeTerminalHookSpoolDir(runtimeDir: string): string {
  return path.join(runtimeDir, "hook-spool");
}

export function claudeTerminalRecoveryPromptPath(runtimeDir: string): string {
  return path.join(runtimeDir, "recovery-prompt.json");
}

function quotePosixShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindowsShell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildClaudeHookCommand(
  executable: string,
  shimPath: string,
  mode?: "status-line",
  platform: NodeJS.Platform = process.platform,
  electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE === "1" && "electron" in process.versions,
): string {
  const quote = platform === "win32" ? quoteWindowsShell : quotePosixShell;
  const command = [quote(executable), quote(shimPath), ...(mode ? ["--status-line"] : [])].join(
    " ",
  );
  if (!electronRunAsNode) return command;
  return platform === "win32"
    ? `set "ELECTRON_RUN_AS_NODE=1"&& ${command}`
    : `ELECTRON_RUN_AS_NODE=1 ${command}`;
}

export function buildClaudeTerminalSettings(hookCommand: string, statusLineCommand: string) {
  const hook = (timeout: number) => ({
    hooks: [{ type: "command", command: hookCommand, timeout }],
  });
  return {
    hooks: {
      SessionStart: [hook(10)],
      UserPromptSubmit: [hook(12)],
      SubagentStart: [hook(10)],
      Stop: [hook(10)],
      StopFailure: [hook(10)],
      SessionEnd: [hook(10)],
    },
    statusLine: {
      type: "command",
      command: statusLineCommand,
      padding: 0,
    },
  };
}

export function buildClaudeTerminalArgs(input: {
  readonly settingsPath: string;
  readonly providerSessionId: string;
  readonly resume?: boolean;
  readonly modelSelection: ClaudeModelSelection;
  readonly runtimeMode: RuntimeMode;
}): ReadonlyArray<string> {
  requireLaunchValue(input.providerSessionId, "Claude session id");
  const args = [
    "--settings",
    input.settingsPath,
    input.resume ? "--resume" : "--session-id",
    input.providerSessionId,
    "--model",
    input.modelSelection.model,
  ];
  const effort = input.modelSelection.options?.effort;
  if (effort) args.push("--effort", effort);
  if (input.runtimeMode === "full-access") {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "manual");
  }
  return args;
}

export async function prepareClaudeTerminalLaunch(input: {
  readonly stateDir: string;
  readonly runtimeInstanceId: string;
  readonly providerSessionId: string;
  readonly hookEndpoint: string;
  readonly hookToken: string;
  readonly executable: string;
  readonly resume?: boolean;
  readonly modelSelection: ClaudeModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): Promise<ClaudeTerminalLaunch> {
  requireLaunchValue(input.hookEndpoint, "Hook endpoint");
  requireLaunchValue(input.hookToken, "Hook token");
  requireLaunchValue(input.executable, "Claude executable");
  const runtimeDir = claudeTerminalRuntimeDir(input.stateDir, input.runtimeInstanceId);
  const spoolDir = claudeTerminalHookSpoolDir(runtimeDir);
  const shimPath = path.join(runtimeDir, "claude-hook.mjs");
  const settingsPath = path.join(runtimeDir, "claude-settings.json");
  await ensurePrivateDirectory(runtimeDir);
  await ensurePrivateDirectory(spoolDir);
  await writePrivateFile(shimPath, buildClaudeHookShimSource(), 0o700);
  const hookCommand = buildClaudeHookCommand(process.execPath, shimPath);
  const statusLineCommand = buildClaudeHookCommand(process.execPath, shimPath, "status-line");
  await writePrivateFile(
    settingsPath,
    `${JSON.stringify(buildClaudeTerminalSettings(hookCommand, statusLineCommand), null, 2)}\n`,
    0o600,
  );
  const providerEnv = buildClaudeProcessEnv({
    env: input.baseEnv ?? process.env,
  });
  return {
    executable: input.executable,
    args: buildClaudeTerminalArgs({
      settingsPath,
      providerSessionId: input.providerSessionId,
      ...(input.resume ? { resume: true } : {}),
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
    }),
    env: buildTerminalAgentProcessEnv(providerEnv, {
      [CLAUDE_DISABLE_AUTOUPDATER_ENV]: "1",
      [CLAUDE_HOOK_ENDPOINT_ENV]: input.hookEndpoint,
      [CLAUDE_HOOK_TOKEN_ENV]: input.hookToken,
      [CLAUDE_HOOK_SPOOL_DIR_ENV]: spoolDir,
      [CLAUDE_RUNTIME_INSTANCE_ID_ENV]: input.runtimeInstanceId,
    }),
    runtimeDir,
    settingsPath,
    shimPath,
  };
}
