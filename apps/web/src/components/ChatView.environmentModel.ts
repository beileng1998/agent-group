import {
  type ModelSelection,
  type ModelSlug,
  type ProviderApprovalDecision,
  type ProviderKind,
  type RuntimeMode,
} from "@agent-group/contracts";
import { normalizeModelSlug } from "@agent-group/shared/model";
import { Schema } from "effect";

import type { ThreadPrimarySurface } from "../types";
import type { ProviderModelOption } from "../providerModelOptions";

export const DISMISSED_PROVIDER_HEALTH_BANNERS_KEY =
  "agent-group:dismissed-provider-health-banners";
export const DismissedProviderHealthBannersSchema = Schema.Array(Schema.String);

const ALWAYS_ALLOW_RUNTIME_MODE: RuntimeMode = "full-access";

/**
 * "Always allow" (acceptForSession) only auto-approves the live provider turn.
 * Because the client is the source of truth for runtime mode (it sends it with
 * every turn), the choice must also flip the thread to full-access so it survives
 * idle-stop and runtime restarts instead of reverting to approval-required on the
 * next turn. Returns the runtime mode to persist, or null when nothing changes.
 */
export function resolveRuntimeModeAfterApprovalDecision(
  currentRuntimeMode: RuntimeMode,
  decision: ProviderApprovalDecision,
): RuntimeMode | null {
  if (decision === "acceptForSession" && currentRuntimeMode !== ALWAYS_ALLOW_RUNTIME_MODE) {
    return ALWAYS_ALLOW_RUNTIME_MODE;
  }
  return null;
}

export function shouldRenderProviderHealthBanner(input: {
  threadEntryPoint: ThreadPrimarySurface;
  terminalWorkspaceTerminalTabActive: boolean;
}): boolean {
  return input.threadEntryPoint === "chat" && !input.terminalWorkspaceTerminalTabActive;
}

// Default-open policy for the Environment panel; render-time visibility is resolved separately.
// `settingsDefaultOpen` is the user preference (Settings → Environment panel). Landing,
// terminal-primary, and constrained layouts always start closed regardless of that setting.
export function resolveDefaultEnvironmentPanelOpen(input: {
  environmentEnabled: boolean;
  isCenteredEmptyLanding: boolean;
  isTerminalPrimarySurface: boolean;
  isConstrainedChatLayout: boolean;
  settingsDefaultOpen?: boolean;
}): boolean {
  const settingsDefaultOpen = input.settingsDefaultOpen ?? false;
  return (
    input.environmentEnabled &&
    settingsDefaultOpen &&
    !input.isCenteredEmptyLanding &&
    !input.isTerminalPrimarySurface &&
    !input.isConstrainedChatLayout
  );
}

// Build the ordered model list used by model.next / model.previous: favorites first
// (stable user order), then remaining discovered options. Returns null when cycling is
// a no-op (fewer than two selectable models).
export function resolveCycledModelSlug(input: {
  currentModel: string;
  options: ReadonlyArray<{ slug: string }>;
  favoriteSlugs?: ReadonlyArray<string>;
  direction: "next" | "previous";
}): string | null {
  const optionSlugs = new Set(
    input.options.map((option) => option.slug.trim()).filter((slug) => slug.length > 0),
  );
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (slug: string) => {
    const trimmed = slug.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };
  for (const favorite of input.favoriteSlugs ?? []) {
    if (optionSlugs.has(favorite.trim())) {
      push(favorite);
    }
  }
  for (const option of input.options) {
    push(option.slug);
  }
  if (ordered.length < 2) {
    return null;
  }
  const currentIndex = ordered.indexOf(input.currentModel.trim());
  if (currentIndex < 0) {
    return input.direction === "next" ? (ordered[0] ?? null) : (ordered.at(-1) ?? null);
  }
  const delta = input.direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + ordered.length) % ordered.length;
  return ordered[nextIndex] ?? null;
}

export function resolveEnvironmentPanelOpen(input: {
  defaultOpen: boolean;
  userPreferenceOpen: boolean | null;
}): boolean {
  return input.userPreferenceOpen ?? input.defaultOpen;
}

export function resolveEnvironmentPanelPreferenceUpdate(input: {
  open: boolean;
  persist: boolean;
}): {
  userPreferenceOpen: boolean;
  settingsDefaultOpen: boolean | null;
} {
  return {
    userPreferenceOpen: input.open,
    settingsDefaultOpen: input.persist ? input.open : null,
  };
}

export function resolveEnvironmentPanelPreferenceAfterFirstSend(input: {
  isCenteredEmptyLanding: boolean;
  settingsDefaultOpen: boolean;
  currentPreferenceOpen: boolean | null;
}): boolean | null {
  if (!input.isCenteredEmptyLanding) {
    return input.currentPreferenceOpen;
  }
  return input.settingsDefaultOpen ? null : false;
}

export function resolveEnvironmentPanelVisible(input: {
  environmentEnabled: boolean;
  environmentPanelOpen: boolean;
}): boolean {
  return input.environmentEnabled && input.environmentPanelOpen;
}

export function shouldShowComposerModelBootstrapSkeleton(input: {
  selectedProvider: ProviderKind;
  selectedModel: string | null | undefined;
  persistedModelSelection: ModelSelection | null | undefined;
  draftModelSelection: ModelSelection | null | undefined;
  providerModelsLoading: boolean;
  requiresDiscoveredModels?: boolean;
}): boolean {
  if (input.requiresDiscoveredModels === true && input.providerModelsLoading) {
    return true;
  }

  const draftSelection = input.draftModelSelection;
  if (draftSelection && draftSelection.provider === input.selectedProvider) {
    return false;
  }

  const persistedSelection = input.persistedModelSelection;
  if (!persistedSelection) {
    return false;
  }

  if (persistedSelection.provider !== input.selectedProvider) {
    return true;
  }

  if (!input.providerModelsLoading) {
    return false;
  }

  const normalizedSelectedModel =
    normalizeModelSlug(input.selectedModel, input.selectedProvider) ?? input.selectedModel;
  const normalizedPersistedModel =
    normalizeModelSlug(persistedSelection.model, persistedSelection.provider) ??
    persistedSelection.model;

  return normalizedSelectedModel !== normalizedPersistedModel;
}

export function resolveCommittedProviderModel(input: {
  selectedModel: ModelSlug;
  availableOptions: ReadonlyArray<ProviderModelOption>;
  fallback: () => string;
}): string {
  const directRuntimeOption = input.availableOptions.find(
    (option) => option.slug === input.selectedModel,
  );
  return directRuntimeOption?.slug ?? input.fallback();
}

// Lets a pending custom binary path re-check a session that was already observed ready.
export function shouldConsumePendingCustomBinaryConfirmation(input: {
  sessionAlreadyChecked: boolean;
  pendingCustomBinaryPath: string | null | undefined;
}): boolean {
  return !input.sessionAlreadyChecked || Boolean(input.pendingCustomBinaryPath);
}
