import type { ProviderKind } from "@agent-group/contracts";
import {
  normalizeCommandPath,
  type PackageManagedProviderMaintenanceDefinition,
} from "../../providerMaintenance";
import {
  ANTIGRAVITY_PROVIDER,
  CLAUDE_AGENT_PROVIDER,
  CODEX_PROVIDER,
  DROID_PROVIDER,
  KILO_PROVIDER,
  OPENCODE_PROVIDER,
  PI_PROVIDER,
} from "./providerHealthConstants";

export function formatProviderUpdateTimeout(timeoutMs: number): string {
  if (timeoutMs < 1_000) {
    return `${timeoutMs} ${timeoutMs === 1 ? "millisecond" : "milliseconds"}`;
  }
  if (timeoutMs % 60_000 === 0) {
    const minutes = timeoutMs / 60_000;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const seconds = timeoutMs / 1_000;
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

function isClaudeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

function isKiloNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.kilo/bin/kilo") ||
    normalized.endsWith("/.local/bin/kilo") ||
    normalized.includes("/.local/share/kilo/bin/")
  );
}

export const PACKAGE_MANAGED_PROVIDER_UPDATES: Partial<
  Record<ProviderKind, PackageManagedProviderMaintenanceDefinition>
> = {
  codex: {
    provider: CODEX_PROVIDER,
    binaryName: "codex",
    npmPackageName: "@openai/codex",
    homebrew: { name: "codex", kind: "cask" },
    nativeUpdate: null,
  },
  claudeAgent: {
    provider: CLAUDE_AGENT_PROVIDER,
    binaryName: "claude",
    npmPackageName: "@anthropic-ai/claude-code",
    homebrew: { name: "claude-code", kind: "cask" },
    nativeUpdate: {
      executable: "claude",
      args: () => ["update"],
      lockKey: "claude-native",
      strategy: "matching-path",
      isCommandPath: isClaudeNativeCommandPath,
    },
  },
  antigravity: {
    provider: ANTIGRAVITY_PROVIDER,
    binaryName: "agy",
    npmPackageName: null,
    homebrew: null,
    latestVersionSource: null,
    nativeUpdate: {
      executable: "agy",
      args: () => ["update"],
      lockKey: "antigravity-native",
      strategy: "always",
    },
  },
  droid: {
    provider: DROID_PROVIDER,
    binaryName: "droid",
    npmPackageName: "@factory/cli",
    homebrew: null,
    nativeUpdate: {
      executable: "droid",
      args: () => ["update"],
      lockKey: "droid-native",
      strategy: "always",
    },
  },
  kilo: {
    provider: KILO_PROVIDER,
    binaryName: "kilo",
    npmPackageName: "@kilocode/cli",
    homebrew: null,
    nativeUpdate: {
      executable: "kilo",
      args: () => ["upgrade"],
      lockKey: "kilo-native",
      strategy: "matching-path",
      isCommandPath: isKiloNativeCommandPath,
    },
  },
  opencode: {
    provider: OPENCODE_PROVIDER,
    binaryName: "opencode",
    npmPackageName: "opencode-ai",
    homebrew: { name: "anomalyco/tap/opencode", kind: "formula" },
    latestVersionSource: { kind: "npm", name: "opencode-ai" },
    nativeUpdate: {
      executable: "opencode",
      args: (installSource) =>
        installSource === "unknown" || installSource === "native"
          ? ["upgrade"]
          : ["upgrade", "--method", installSource],
      lockKey: "opencode-native",
      strategy: "always",
      excludedInstallSources: ["homebrew"],
      isCommandPath: isOpenCodeNativeCommandPath,
    },
  },
  pi: {
    provider: PI_PROVIDER,
    binaryName: "pi",
    npmPackageName: "@earendil-works/pi-coding-agent",
    homebrew: null,
    nativeUpdate: {
      executable: "pi",
      args: () => ["update"],
      lockKey: "pi-native",
      strategy: "always",
    },
  },
};
