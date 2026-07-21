import {
  type ClaudeApiEffort,
  type ClaudeCodeEffort,
  type ModelSelection,
} from "@agent-group/contracts";
import { getModelCapabilities, hasEffortLevel } from "./modelCapabilities";
import { getModelOptions, trimOrNull } from "./modelSlugs";

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function resolveApiModelId(modelSelection: ModelSelection): string {
  return modelSelection.model;
}

/**
 * Map a requested Claude Code effort to the API effort passed at session spawn.
 * `ultrathink` is prompt-injected (no API effort); `ultracode` runs as xhigh plus
 * the `ultracode` session setting.
 */
export function getEffectiveClaudeCodeEffort(
  effort: ClaudeCodeEffort | null | undefined,
): ClaudeApiEffort | null {
  if (!effort || effort === "ultrathink") {
    return null;
  }
  return effort === "ultracode" ? "xhigh" : effort;
}

interface ClaudeSpawnProfile {
  readonly effectiveEffort: ClaudeApiEffort | null;
  readonly thinking: boolean | undefined;
  readonly fastMode: boolean;
  readonly ultracode: boolean;
}

interface ClaudeRequestedSpawnOptions {
  readonly effort: string | null;
  readonly thinking: boolean | undefined;
  readonly fastMode: boolean;
}

function claudeRequestedSpawnOptions(
  selection: Extract<ModelSelection, { provider: "claudeAgent" }>,
): ClaudeRequestedSpawnOptions {
  return {
    effort: trimOrNull(selection.options?.effort ?? null),
    thinking:
      typeof selection.options?.thinking === "boolean" ? selection.options.thinking : undefined,
    fastMode: selection.options?.fastMode === true,
  };
}

function sameClaudeRequestedSpawnOptions(
  previous: Extract<ModelSelection, { provider: "claudeAgent" }>,
  next: Extract<ModelSelection, { provider: "claudeAgent" }>,
): boolean {
  const prev = claudeRequestedSpawnOptions(previous);
  const desired = claudeRequestedSpawnOptions(next);
  return (
    prev.effort === desired.effort &&
    prev.thinking === desired.thinking &&
    prev.fastMode === desired.fastMode
  );
}

// Mirrors the spawn-time option derivation in the Claude adapter's startSession:
// only these inputs are fixed at subprocess spawn (query `effort` + `settings`).
// Model and context window switch in-session via `setModel`.
function claudeSpawnProfile(selection: Extract<ModelSelection, { provider: "claudeAgent" }>) {
  const caps = getModelCapabilities("claudeAgent", selection.model);
  const requestedEffort = trimOrNull(selection.options?.effort ?? null);
  const hasStaticCapabilities = getModelOptions("claudeAgent").some(
    (model) => model.slug === selection.model,
  );
  const effort =
    requestedEffort && (!hasStaticCapabilities || hasEffortLevel(caps, requestedEffort))
      ? requestedEffort
      : null;
  return {
    effectiveEffort: getEffectiveClaudeCodeEffort(effort as ClaudeCodeEffort | null),
    thinking:
      typeof selection.options?.thinking === "boolean" &&
      (!hasStaticCapabilities || caps.supportsThinkingToggle)
        ? selection.options.thinking
        : undefined,
    fastMode:
      selection.options?.fastMode === true && (!hasStaticCapabilities || caps.supportsFastMode),
    ultracode:
      effort === "ultracode" && (!hasStaticCapabilities || hasEffortLevel(caps, "xhigh")),
  } satisfies ClaudeSpawnProfile;
}

/**
 * Whether switching from `previous` to `next` requires restarting the Claude
 * subprocess. Restarting resumes via `--resume`, which replays the whole
 * conversation as uncached input tokens, so it must only happen for options
 * fixed at spawn (effort/settings). Model changes use `setModel`, while the
 * auto-compact budget uses the SDK's live flag-settings control.
 */
export function claudeSelectionRequiresRestart(
  previous: ModelSelection | undefined,
  next: ModelSelection,
): boolean {
  if (next.provider !== "claudeAgent") {
    return false;
  }
  if (previous === undefined) {
    // First observation in this process: the live session was started from the
    // same selection source, so treat it as unchanged rather than replaying.
    return false;
  }
  if (previous.provider !== "claudeAgent") {
    return true;
  }
  if (previous.model !== next.model && sameClaudeRequestedSpawnOptions(previous, next)) {
    // A model switch is handled by setModel. Do not interpret the new model's
    // different capabilities as a spawn-setting change when the requested
    // options themselves are unchanged (for example, a stale Haiku `thinking`
    // override or Opus `fastMode` flag carried into the next selection).
    return false;
  }
  const prev = claudeSpawnProfile(previous);
  const desired = claudeSpawnProfile(next);
  return (
    prev.effectiveEffort !== desired.effectiveEffort ||
    prev.thinking !== desired.thinking ||
    prev.fastMode !== desired.fastMode ||
    prev.ultracode !== desired.ultracode
  );
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}
