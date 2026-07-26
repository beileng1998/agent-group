import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { CodexModelSelection, RuntimeMode } from "@agent-group/contracts";

import { buildCodexProcessEnv } from "../codexProcessEnv";
import { AGENT_GROUP_CODEX_HOME_OVERLAY_DIR } from "../codexHomePaths";
import { mapCodexRuntimeMode } from "../provider/codexManagerProtocol";
import { buildCodexHookShimSource } from "./codexHookShim";
import {
  buildTerminalAgentProcessEnv,
  ensurePrivateDirectory,
  requireLaunchValue,
  requireRuntimeId,
  writePrivateFile,
} from "./terminalAgentDriverFiles";
import type { TerminalAgentDriverLaunch } from "./terminalAgentProtocol";

export const CODEX_TERMINAL_PROFILE_NAME = "agent-group-terminal";
export const CODEX_HOOK_ENDPOINT_ENV = "AGENT_GROUP_HOOK_ENDPOINT";
export const CODEX_HOOK_TOKEN_ENV = "AGENT_GROUP_HOOK_TOKEN";
export const CODEX_RUNTIME_INSTANCE_ID_ENV = "AGENT_GROUP_RUNTIME_INSTANCE_ID";
export const CODEX_HOOK_SPOOL_DIR_ENV = "AGENT_GROUP_HOOK_SPOOL_DIR";

const CODEX_TERMINAL_HOOKS = [
  { eventName: "SessionStart", timeout: 10 },
  { eventName: "UserPromptSubmit", timeout: 12 },
  { eventName: "SubagentStart", timeout: 10 },
  { eventName: "Stop", timeout: 10 },
] as const;

export interface CodexTerminalLaunch extends TerminalAgentDriverLaunch {
  readonly codexHome: string;
  readonly profilePath: string;
  readonly shimPath: string;
}

function stableSessionHash(sessionKey: string): string {
  requireLaunchValue(sessionKey, "Codex Terminal session key");
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 24);
}

export function codexTerminalRuntimeDir(stateDir: string, sessionKey: string): string {
  requireLaunchValue(stateDir, "State directory");
  return path.join(stateDir, "terminal-agent", "codex", stableSessionHash(sessionKey));
}

export function codexTerminalHookSpoolDir(runtimeDir: string): string {
  return path.join(runtimeDir, "hook-spool");
}

export function codexTerminalRecoveryPromptPath(runtimeDir: string): string {
  return path.join(runtimeDir, "recovery-prompt.json");
}

function quotePosixShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindowsShell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildCodexHookCommand(
  executable: string,
  shimPath: string,
  platform: NodeJS.Platform = process.platform,
  electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE === "1" && "electron" in process.versions,
): string {
  const quote = platform === "win32" ? quoteWindowsShell : quotePosixShell;
  const command = `${quote(executable)} ${quote(shimPath)}`;
  if (!electronRunAsNode) return command;
  return platform === "win32"
    ? `set "ELECTRON_RUN_AS_NODE=1"&& ${command}`
    : `ELECTRON_RUN_AS_NODE=1 ${command}`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function buildCodexTerminalProfile(hookCommand: string, workspaceRoot: string): string {
  requireLaunchValue(workspaceRoot, "Codex Terminal workspace root");
  const lines: string[] = [];
  for (const hook of CODEX_TERMINAL_HOOKS) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `[[hooks.${hook.eventName}]]`,
      "",
      `[[hooks.${hook.eventName}.hooks]]`,
      'type = "command"',
      `command = ${tomlString(hookCommand)}`,
      `timeout = ${hook.timeout}`,
    );
  }
  lines.push("", `[projects.${tomlString(workspaceRoot)}]`, 'trust_level = "trusted"');
  return `${lines.join("\n")}\n`;
}

export function buildCodexTerminalArgs(input: {
  readonly profileName: string;
  readonly modelSelection: CodexModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly resumeSessionId?: string;
}): ReadonlyArray<string> {
  const permission = mapCodexRuntimeMode(input.runtimeMode);
  const options = [
    "--dangerously-bypass-hook-trust",
    "--no-alt-screen",
    "--profile",
    input.profileName,
    "--enable",
    "hooks",
    "--model",
    input.modelSelection.model,
    "--sandbox",
    permission.sandbox,
    "--ask-for-approval",
    permission.approvalPolicy,
  ];
  const effort = input.modelSelection.options?.reasoningEffort;
  if (effort) {
    options.push("-c", `model_reasoning_effort=${tomlString(effort)}`);
  }
  const fastMode = input.modelSelection.options?.fastMode;
  if (fastMode !== undefined) {
    options.push(
      "--enable",
      "fast_mode",
      "-c",
      `service_tier=${tomlString(fastMode ? "fast" : "default")}`,
    );
  }
  if (input.resumeSessionId === undefined) return options;
  requireLaunchValue(input.resumeSessionId, "Codex resume session id");
  return ["resume", input.resumeSessionId, ...options];
}

export async function prepareCodexTerminalLaunch(input: {
  readonly stateDir: string;
  readonly sessionKey: string;
  readonly workspaceRoot: string;
  readonly runtimeInstanceId: string;
  readonly hookEndpoint: string;
  readonly hookToken: string;
  readonly executable: string;
  readonly modelSelection: CodexModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly resumeSessionId?: string;
  readonly codexHomePath?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): Promise<CodexTerminalLaunch> {
  requireRuntimeId(input.runtimeInstanceId);
  requireLaunchValue(input.hookEndpoint, "Hook endpoint");
  requireLaunchValue(input.hookToken, "Hook token");
  requireLaunchValue(input.executable, "Codex executable");
  const runtimeDir = codexTerminalRuntimeDir(input.stateDir, input.sessionKey);
  const environmentRoot = path.join(runtimeDir, "codex-environment");
  const expectedCodexHome = path.join(environmentRoot, AGENT_GROUP_CODEX_HOME_OVERLAY_DIR);
  await ensurePrivateDirectory(runtimeDir);

  const baseEnv = { ...(input.baseEnv ?? process.env) };
  const effectiveEnv = buildCodexProcessEnv({
    env: { ...baseEnv, AGENT_GROUP_HOME: environmentRoot },
    ...(input.codexHomePath ? { homePath: input.codexHomePath } : {}),
  });
  const codexHome = effectiveEnv.CODEX_HOME;
  if (!codexHome || path.resolve(codexHome) !== path.resolve(expectedCodexHome)) {
    throw new Error("Failed to prepare the Codex Terminal home.");
  }
  const canonicalCodexHome = await fs.realpath(codexHome);
  const profilePath = path.join(canonicalCodexHome, `${CODEX_TERMINAL_PROFILE_NAME}.config.toml`);
  effectiveEnv.CODEX_HOME = canonicalCodexHome;

  const spoolDir = codexTerminalHookSpoolDir(runtimeDir);
  const shimPath = path.join(runtimeDir, "codex-hook.mjs");
  await ensurePrivateDirectory(spoolDir);
  await writePrivateFile(shimPath, buildCodexHookShimSource(), 0o700);
  const hookCommand = buildCodexHookCommand(process.execPath, shimPath);
  await writePrivateFile(
    profilePath,
    buildCodexTerminalProfile(hookCommand, input.workspaceRoot),
    0o600,
  );

  return {
    executable: input.executable,
    args: buildCodexTerminalArgs({
      profileName: CODEX_TERMINAL_PROFILE_NAME,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
    }),
    env: buildTerminalAgentProcessEnv(effectiveEnv, {
      [CODEX_HOOK_ENDPOINT_ENV]: input.hookEndpoint,
      [CODEX_HOOK_TOKEN_ENV]: input.hookToken,
      [CODEX_HOOK_SPOOL_DIR_ENV]: spoolDir,
      [CODEX_RUNTIME_INSTANCE_ID_ENV]: input.runtimeInstanceId,
    }),
    runtimeDir,
    codexHome: canonicalCodexHome,
    profilePath,
    shimPath,
  };
}
