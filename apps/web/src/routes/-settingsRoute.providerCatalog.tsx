import type { ProviderKind, ServerProviderStatus } from "@agent-group/contracts";
import type { ReactNode } from "react";

import { ExternalLinkIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import { SETTINGS_INSET_LIST_CLASS_NAME, SETTINGS_RADIUS_CLASS_NAME } from "../settingsPanelStyles";

export type InstallBinarySettingsKey =
  | "claudeBinaryPath"
  | "codexBinaryPath"
  | "cursorBinaryPath"
  | "antigravityBinaryPath"
  | "grokBinaryPath"
  | "droidBinaryPath"
  | "kiloBinaryPath"
  | "openCodeBinaryPath"
  | "piBinaryPath";

export type InstallProviderSettings = {
  provider: ProviderKind;
  title: string;
  docs: ReadonlyArray<{
    label: string;
    href: string;
  }>;
  binaryPathKey: InstallBinarySettingsKey;
  binaryPlaceholder: string;
  binaryDescription: ReactNode;
  homePathKey?: "codexHomePath";
  homePlaceholder?: string;
  homeDescription?: ReactNode;
  apiEndpointKey?: "cursorApiEndpoint";
  apiEndpointPlaceholder?: string;
  apiEndpointDescription?: ReactNode;
  serverUrlKey?: "kiloServerUrl" | "openCodeServerUrl";
  serverUrlPlaceholder?: string;
  serverUrlDescription?: ReactNode;
  serverPasswordKey?: "kiloServerPassword" | "openCodeServerPassword";
  serverPasswordPlaceholder?: string;
  serverPasswordDescription?: ReactNode;
  experimentalWebSocketsKey?: "openCodeExperimentalWebSockets";
  experimentalWebSocketsDescription?: ReactNode;
  agentDirKey?: "piAgentDir";
  agentDirPlaceholder?: string;
  agentDirDescription?: ReactNode;
};

export const INSTALL_PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    docs: [
      { label: "Install", href: "https://help.openai.com/en/articles/11096431" },
      { label: "Update", href: "https://help.openai.com/en/articles/11096431" },
      { label: "Config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
    binaryPathKey: "codexBinaryPath",
    binaryPlaceholder: "Codex binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>codex</code> from your PATH.
      </>
    ),
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
    homeDescription: "Optional custom Codex home and config directory.",
  },
  {
    provider: "claudeAgent",
    title: "Claude",
    docs: [
      { label: "Install", href: "https://code.claude.com/docs/en/installation" },
      { label: "Update", href: "https://code.claude.com/docs/en/installation#update-claude-code" },
      { label: "Config", href: "https://code.claude.com/docs/en/settings" },
    ],
    binaryPathKey: "claudeBinaryPath",
    binaryPlaceholder: "Claude binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>claude</code> from your PATH.
      </>
    ),
  },
  {
    provider: "cursor",
    title: "Cursor",
    docs: [
      { label: "Install", href: "https://docs.cursor.com/en/cli/installation" },
      { label: "Update", href: "https://docs.cursor.com/en/cli/installation#updates" },
      { label: "Config", href: "https://docs.cursor.com/en/cli/overview" },
    ],
    binaryPathKey: "cursorBinaryPath",
    binaryPlaceholder: "Cursor Agent or Cursor CLI path",
    binaryDescription: (
      <>
        Leave blank to use <code>cursor-agent</code> from your PATH. Cursor editor CLI paths are
        accepted too.
      </>
    ),
    apiEndpointKey: "cursorApiEndpoint",
    apiEndpointPlaceholder: "https://api2.cursor.sh",
    apiEndpointDescription: "Optional Cursor API endpoint override passed to `cursor-agent -e`.",
  },
  {
    provider: "antigravity",
    title: "Antigravity",
    docs: [
      { label: "Install", href: "https://antigravity.google/docs/cli-using" },
      { label: "Reference", href: "https://antigravity.google/docs/cli-reference" },
      { label: "Hooks", href: "https://antigravity.google/docs/hooks" },
    ],
    binaryPathKey: "antigravityBinaryPath",
    binaryPlaceholder: "Antigravity CLI binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>agy</code> from your PATH.
      </>
    ),
  },
  {
    provider: "grok",
    title: "Grok",
    docs: [
      { label: "Install", href: "https://docs.x.ai/build/overview" },
      { label: "Headless", href: "https://docs.x.ai/build/cli/headless-scripting" },
      { label: "Config", href: "https://docs.x.ai/build/overview" },
    ],
    binaryPathKey: "grokBinaryPath",
    binaryPlaceholder: "Grok binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>grok</code> from your PATH.
      </>
    ),
  },
  {
    provider: "droid",
    title: "Droid",
    docs: [
      {
        label: "Quickstart",
        href: "https://docs.factory.ai/cli/getting-started/quickstart.md",
      },
    ],
    binaryPathKey: "droidBinaryPath",
    binaryPlaceholder: "droid",
    binaryDescription: (
      <>
        Leave blank to use <code>droid</code> from your PATH.
      </>
    ),
  },
  {
    provider: "kilo",
    title: "Kilo",
    docs: [
      { label: "Install", href: "https://kilo.ai/docs/cli" },
      { label: "Update", href: "https://kilo.ai/docs/cli" },
      { label: "Config", href: "https://kilo.ai/docs/cli#configuration" },
    ],
    binaryPathKey: "kiloBinaryPath",
    binaryPlaceholder: "Kilo binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>kilo</code> from your PATH.
      </>
    ),
    serverUrlKey: "kiloServerUrl",
    serverUrlPlaceholder: "http://127.0.0.1:4096",
    serverUrlDescription: "Optional existing Kilo server URL. Leave blank to spawn a local server.",
    serverPasswordKey: "kiloServerPassword",
    serverPasswordPlaceholder: "Kilo server password",
    serverPasswordDescription: "Optional password for an externally managed Kilo server.",
  },
  {
    provider: "opencode",
    title: "OpenCode",
    docs: [
      { label: "Install", href: "https://opencode.ai/docs/" },
      { label: "Update", href: "https://opencode.ai/docs/cli/" },
      { label: "Config", href: "https://opencode.ai/docs/config/" },
    ],
    binaryPathKey: "openCodeBinaryPath",
    binaryPlaceholder: "OpenCode binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>opencode</code> from your PATH.
      </>
    ),
    serverUrlKey: "openCodeServerUrl",
    serverUrlPlaceholder: "http://127.0.0.1:4096",
    serverUrlDescription:
      "Optional existing OpenCode server URL. Leave blank to spawn a local server.",
    serverPasswordKey: "openCodeServerPassword",
    serverPasswordPlaceholder: "OpenCode server password",
    serverPasswordDescription: "Optional password for an externally managed OpenCode server.",
    experimentalWebSocketsKey: "openCodeExperimentalWebSockets",
    experimentalWebSocketsDescription:
      "Use Opencode's experimental OpenAI response WebSocket transport for managed local servers.",
  },
  {
    provider: "pi",
    title: "Pi",
    docs: [
      { label: "Install", href: "https://pi.dev/docs/latest" },
      { label: "Update", href: "https://pi.dev/docs/latest/settings" },
      { label: "Config", href: "https://pi.dev/docs/latest/settings" },
    ],
    binaryPathKey: "piBinaryPath",
    binaryPlaceholder: "Pi binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>pi</code> from your PATH.
      </>
    ),
    agentDirKey: "piAgentDir",
    agentDirPlaceholder: "Pi agent directory",
    agentDirDescription:
      "Optional custom Pi agent directory for auth, models, skills, and commands.",
  },
];

export function ProviderDocsLinks({ docs }: { docs: InstallProviderSettings["docs"] }) {
  return (
    <div className={cn(SETTINGS_INSET_LIST_CLASS_NAME, "px-3 py-2.5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-foreground">CLI docs</span>
        <div className="flex flex-wrap gap-2">
          {docs.map((doc) => (
            <a
              key={`${doc.label}:${doc.href}`}
              href={doc.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 border border-[color:var(--color-border)] bg-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
                SETTINGS_RADIUS_CLASS_NAME,
              )}
            >
              <span>{doc.label}</span>
              <ExternalLinkIcon className="size-3" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function normalizeManagedWorktreePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function formatProviderVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function providerUpdateStatusLabel(provider: ServerProviderStatus): string | null {
  const state = provider.updateState?.status;
  if (state === "queued") {
    return "Update queued";
  }
  if (state === "running") {
    return "Updating";
  }
  if (state === "succeeded") {
    return "Updated";
  }
  if (state === "failed") {
    return "Update failed";
  }
  if (state === "unchanged") {
    return "Still outdated";
  }
  const advisory = provider.versionAdvisory;
  if (advisory?.status === "behind_latest" && advisory.latestVersion) {
    const currentVersion = formatProviderVersion(advisory.currentVersion);
    const latestVersion = formatProviderVersion(advisory.latestVersion);
    return currentVersion ? `${currentVersion} -> ${latestVersion}` : `Latest ${latestVersion}`;
  }
  const currentVersion = formatProviderVersion(provider.version);
  return currentVersion ? `Current ${currentVersion}` : null;
}

export function providerUpdateFailureMessage(
  provider: ServerProviderStatus | undefined,
): string | null {
  const state = provider?.updateState;
  if (!state || (state.status !== "failed" && state.status !== "unchanged")) {
    return null;
  }
  return state.output?.trim() || state.message || "The provider update did not complete.";
}
