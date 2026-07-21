import { spawnSync } from "node:child_process";

import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";

import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "./codexCliVersion";
import { buildCodexProcessEnv } from "../codexProcessEnv.ts";
import { CODEX_VERSION_CHECK_TIMEOUT_MS } from "./codexManagerProtocol.ts";

export interface CodexCliVersionCheckInput {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly homePath?: string;
}

export function assertSupportedCodexCliVersion(input: CodexCliVersionCheckInput): void {
  const env = buildCodexProcessEnv({
    ...(input.homePath ? { homePath: input.homePath } : {}),
  });
  const prepared = prepareWindowsSafeProcess(input.binaryPath, ["--version"], {
    cwd: input.cwd,
    env,
  });
  const result = spawnSync(prepared.command, prepared.args, {
    cwd: input.cwd,
    env,
    encoding: "utf8",
    shell: prepared.shell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: prepared.windowsHide,
    windowsVerbatimArguments: prepared.windowsVerbatimArguments,
  });

  if (result.error) {
    const lower = result.error.message.toLowerCase();
    if (
      lower.includes("enoent") ||
      lower.includes("command not found") ||
      lower.includes("not found")
    ) {
      throw new Error(`Codex CLI (${input.binaryPath}) is not installed or not executable.`);
    }
    throw new Error(
      `Failed to execute Codex CLI version check: ${result.error.message || String(result.error)}`,
    );
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `Command exited with code ${result.status}.`;
    throw new Error(`Codex CLI version check failed. ${detail}`);
  }

  const parsedVersion = parseCodexCliVersion(`${stdout}\n${stderr}`);
  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    throw new Error(formatCodexCliUpgradeMessage(parsedVersion));
  }
}
