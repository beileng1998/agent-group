import type {
  EditorId,
  ProjectEntry,
  ProviderAgentDescriptor,
  ProviderKind,
  ProviderNativeCommandDescriptor,
  ProviderSkillDescriptor,
  ProviderStartOptions,
  ResolvedKeybindingsConfig,
  ServerProviderStatus,
} from "@agent-group/contracts";

import { normalizeCustomBinaryPath } from "../../lib/providerAvailability";
import type { Thread } from "../../types";
import type { RateLimitStatus } from "./RateLimitBanner";

export const EMPTY_HIDDEN_PROVIDERS: ProviderKind[] = [];
export const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
export const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
export const EMPTY_PROVIDER_NATIVE_COMMANDS: ProviderNativeCommandDescriptor[] = [];
export const EMPTY_PROVIDER_SKILLS: ProviderSkillDescriptor[] = [];
export const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
export const EMPTY_PROVIDER_STATUSES: ServerProviderStatus[] = [];
export const EMPTY_PROVIDER_AGENTS: readonly ProviderAgentDescriptor[] = [];
export const MAX_DISMISSED_PROVIDER_HEALTH_BANNERS = 50;

export function getThreadProviderCustomBinaryPathKey(
  threadId: Thread["id"],
  provider: ProviderKind,
) {
  return `${threadId}:${provider}`;
}

export function getConfirmedCustomBinarySessionKey(
  thread: Thread | null | undefined,
  provider: ProviderKind,
): string | null {
  const session = thread?.session;
  if (!thread || session?.provider !== provider) {
    return null;
  }
  if (session.status !== "ready" && session.status !== "running") {
    return null;
  }
  return getThreadProviderCustomBinaryPathKey(thread.id, provider);
}

export function getProviderStartOptionsCustomBinaryPath(
  providerOptions: ProviderStartOptions | undefined,
  provider: ProviderKind,
): string | null {
  switch (provider) {
    case "codex":
      return normalizeCustomBinaryPath(providerOptions?.codex?.binaryPath);
    case "claudeAgent":
      return normalizeCustomBinaryPath(providerOptions?.claudeAgent?.binaryPath);
    case "antigravity":
      return normalizeCustomBinaryPath(providerOptions?.antigravity?.binaryPath);
    case "grok":
      return normalizeCustomBinaryPath(providerOptions?.grok?.binaryPath);
    case "droid":
      return normalizeCustomBinaryPath(providerOptions?.droid?.binaryPath);
    case "kilo":
      return normalizeCustomBinaryPath(providerOptions?.kilo?.binaryPath);
    case "opencode":
      return normalizeCustomBinaryPath(providerOptions?.opencode?.binaryPath);
    case "cursor":
      return normalizeCustomBinaryPath(providerOptions?.cursor?.binaryPath);
    case "pi":
      return normalizeCustomBinaryPath(providerOptions?.pi?.binaryPath);
  }
}

export function getProviderHealthBannerDismissalKey(
  status: ServerProviderStatus | null,
): string | null {
  if (!status || status.status === "ready") {
    return null;
  }
  return [
    status.provider,
    status.status,
    status.available ? "available" : "unavailable",
    status.authStatus,
    status.message?.trim() ?? "",
  ].join("\u001f");
}

export function getRateLimitBannerDismissalKey(
  status: RateLimitStatus | null,
  threadId: Thread["id"] | null,
): string | null {
  if (!status || !threadId) {
    return null;
  }
  return [
    threadId,
    status.status,
    status.resetsAt ?? "",
    typeof status.utilization === "number" ? String(Math.round(status.utilization * 100)) : "",
  ].join("\u001f");
}
