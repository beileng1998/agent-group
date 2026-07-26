import { CLAUDE_CODE_EFFORT_OPTIONS, PI_THINKING_LEVEL_OPTIONS } from "@agent-group/contracts";

import type { ManagedTerminalModelSelection } from "./terminalAgentRuntimeTypes";

export interface TerminalAgentModelObservation {
  readonly model?: string;
  readonly effort?: string;
}

const CLAUDE_EFFORTS = new Set<string>(CLAUDE_CODE_EFFORT_OPTIONS);
const PI_THINKING_LEVELS = new Set<string>(PI_THINKING_LEVEL_OPTIONS);

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function terminalAgentSelectionEffort(
  selection: ManagedTerminalModelSelection,
): string | null {
  switch (selection.provider) {
    case "codex":
      return selection.options?.reasoningEffort ?? null;
    case "claudeAgent":
      return selection.options?.effort ?? null;
    case "pi":
      return selection.options?.thinkingLevel ?? null;
  }
}

export function terminalAgentModelSelectionFromObservation(
  current: ManagedTerminalModelSelection,
  observation: TerminalAgentModelObservation,
): ManagedTerminalModelSelection {
  const observedModel = nonEmpty(observation.model);
  const observedEffort = nonEmpty(observation.effort);
  const model = observedModel ?? current.model;

  switch (current.provider) {
    case "codex": {
      const effort = observedEffort ?? current.options?.reasoningEffort;
      if (model === current.model && effort === current.options?.reasoningEffort) {
        return current;
      }
      return {
        ...current,
        model,
        options:
          effort === undefined ? current.options : { ...current.options, reasoningEffort: effort },
      };
    }
    case "claudeAgent": {
      const effort =
        observedEffort && CLAUDE_EFFORTS.has(observedEffort)
          ? (observedEffort as NonNullable<typeof current.options>["effort"])
          : current.options?.effort;
      if (model === current.model && effort === current.options?.effort) {
        return current;
      }
      return {
        ...current,
        model,
        options: effort === undefined ? current.options : { ...current.options, effort },
      };
    }
    case "pi": {
      const thinkingLevel =
        observedEffort && PI_THINKING_LEVELS.has(observedEffort)
          ? (observedEffort as NonNullable<typeof current.options>["thinkingLevel"])
          : current.options?.thinkingLevel;
      if (model === current.model && thinkingLevel === current.options?.thinkingLevel) {
        return current;
      }
      return {
        ...current,
        model,
        options:
          thinkingLevel === undefined ? current.options : { ...current.options, thinkingLevel },
      };
    }
  }
}
