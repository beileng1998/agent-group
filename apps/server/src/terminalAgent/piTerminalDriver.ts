import path from "node:path";

import type { PiModelSelection, RuntimeMode } from "@agent-group/contracts";

import { buildPiTerminalExtensionSource } from "./piTerminalExtension";
import { piTerminalSessionDir, validatePiTerminalSessionFile } from "./piTerminalSessionFile";
import {
  buildTerminalAgentProcessEnv,
  ensurePrivateDirectory,
  requireLaunchValue,
  requireRuntimeId,
  writePrivateFile,
} from "./terminalAgentDriverFiles";
import type { TerminalAgentDriverLaunch } from "./terminalAgentProtocol";

export const PI_HOOK_ENDPOINT_ENV = "AGENT_GROUP_HOOK_ENDPOINT";
export const PI_HOOK_TOKEN_ENV = "AGENT_GROUP_HOOK_TOKEN";
export const PI_RUNTIME_INSTANCE_ID_ENV = "AGENT_GROUP_RUNTIME_INSTANCE_ID";
export const PI_HOOK_SPOOL_DIR_ENV = "AGENT_GROUP_PI_HOOK_SPOOL_DIR";
export const PI_RUNTIME_MODE_ENV = "AGENT_GROUP_PI_RUNTIME_MODE";
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

export interface PiTerminalLaunch extends TerminalAgentDriverLaunch {
  readonly sessionDir: string;
  readonly extensionPath: string;
}

export function piTerminalRuntimeDir(stateDir: string, runtimeInstanceId: string): string {
  requireLaunchValue(stateDir, "State directory");
  requireRuntimeId(runtimeInstanceId);
  return path.join(stateDir, "terminal-agent", "pi", runtimeInstanceId);
}

export { piTerminalSessionDir } from "./piTerminalSessionFile";

export function piTerminalHookSpoolDir(runtimeDir: string): string {
  return path.join(runtimeDir, "hook-spool");
}

export function buildPiTerminalArgs(input: {
  readonly extensionPath: string;
  readonly sessionDir: string;
  readonly providerSessionId?: string;
  readonly resumeSessionPath?: string;
  readonly modelSelection: PiModelSelection;
}): ReadonlyArray<string> {
  const providerSessionId = input.providerSessionId?.trim();
  const resumeSessionPath = input.resumeSessionPath?.trim();
  if (Boolean(providerSessionId) === Boolean(resumeSessionPath)) {
    throw new Error("Pi requires exactly one session id or resume path.");
  }
  const args = [
    "--no-extensions",
    "-e",
    input.extensionPath,
    ...(resumeSessionPath
      ? ["--session", resumeSessionPath]
      : ["--session-id", providerSessionId!]),
    "--session-dir",
    input.sessionDir,
    "--model",
    input.modelSelection.model,
  ];
  const thinkingLevel = input.modelSelection.options?.thinkingLevel;
  if (thinkingLevel) args.push("--thinking", thinkingLevel);
  return args;
}

export async function preparePiTerminalLaunch(input: {
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly runtimeInstanceId: string;
  readonly providerSessionId?: string;
  readonly resumeSessionPath?: string;
  readonly hookEndpoint: string;
  readonly hookToken: string;
  readonly executable: string;
  readonly modelSelection: PiModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly agentDir?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): Promise<PiTerminalLaunch> {
  requireLaunchValue(input.hookEndpoint, "Hook endpoint");
  requireLaunchValue(input.hookToken, "Hook token");
  requireLaunchValue(input.executable, "Pi executable");
  const runtimeDir = piTerminalRuntimeDir(input.stateDir, input.runtimeInstanceId);
  const sessionDir = piTerminalSessionDir(input.stateDir);
  const spoolDir = piTerminalHookSpoolDir(runtimeDir);
  const extensionPath = path.join(runtimeDir, "agent-group-pi-extension.mjs");
  await ensurePrivateDirectory(runtimeDir);
  await ensurePrivateDirectory(sessionDir);
  await ensurePrivateDirectory(spoolDir);
  const resumeSessionPath = input.resumeSessionPath
    ? (
        await validatePiTerminalSessionFile({
          stateDir: input.stateDir,
          workspaceRoot: input.workspaceRoot,
          sessionPath: input.resumeSessionPath,
          ...(input.providerSessionId ? { expectedSessionId: input.providerSessionId } : {}),
        })
      ).path
    : undefined;
  await writePrivateFile(extensionPath, buildPiTerminalExtensionSource(), 0o700);
  return {
    executable: input.executable,
    args: buildPiTerminalArgs({
      extensionPath,
      sessionDir,
      ...(resumeSessionPath
        ? { resumeSessionPath }
        : input.providerSessionId
          ? { providerSessionId: input.providerSessionId }
          : {}),
      modelSelection: input.modelSelection,
    }),
    env: buildTerminalAgentProcessEnv(input.baseEnv ?? process.env, {
      [PI_HOOK_ENDPOINT_ENV]: input.hookEndpoint,
      [PI_HOOK_TOKEN_ENV]: input.hookToken,
      [PI_RUNTIME_INSTANCE_ID_ENV]: input.runtimeInstanceId,
      [PI_HOOK_SPOOL_DIR_ENV]: spoolDir,
      [PI_RUNTIME_MODE_ENV]: input.runtimeMode,
      ...(input.agentDir?.trim() ? { [PI_AGENT_DIR_ENV]: input.agentDir.trim() } : {}),
    }),
    runtimeDir,
    sessionDir,
    extensionPath,
  };
}
