import type { TerminalActivityState, TerminalCliKind } from "@agent-group/shared/terminalThreads";
import { createUniqueTerminalTitle } from "./terminalStateIdentity";
import { normalizeThreadTerminalState } from "./terminalStateNormalization";
import type { ThreadTerminalState } from "./terminalStateTypes";

// Persist terminal identity without renaming tabs on every command; titles stay stable once assigned.
export function setThreadTerminalMetadata(
  state: ThreadTerminalState,
  terminalId: string,
  metadata: {
    cliKind: TerminalCliKind | null;
    label: string;
  },
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const currentLabel = normalized.terminalLabelsById[terminalId] ?? "";
  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId]?.trim() ?? "";
  const currentCliKind = normalized.terminalCliKindsById[terminalId] ?? null;
  const nextCliKind = metadata.cliKind;
  const nextLabel =
    currentTitleOverride.length > 0
      ? currentLabel
      : nextCliKind !== null
        ? createUniqueTerminalTitle({
            cliKind: nextCliKind,
            excludeTerminalId: terminalId,
            terminalLabelsById: normalized.terminalLabelsById,
            terminalTitleOverridesById: normalized.terminalTitleOverridesById,
          })
        : metadata.label.trim().length > 0
          ? metadata.label.trim()
          : currentLabel;
  if (currentLabel === nextLabel && currentCliKind === nextCliKind) {
    return normalized;
  }
  const nextCliKindsById = { ...normalized.terminalCliKindsById };
  if (nextCliKind === null) {
    delete nextCliKindsById[terminalId];
  } else {
    nextCliKindsById[terminalId] = nextCliKind;
  }
  return {
    ...normalized,
    terminalLabelsById: {
      ...normalized.terminalLabelsById,
      [terminalId]: nextLabel,
    },
    terminalCliKindsById: nextCliKindsById,
  };
}

export function setThreadTerminalCliKind(
  state: ThreadTerminalState,
  terminalId: string,
  cliKind: TerminalCliKind | null,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const currentCliKind = normalized.terminalCliKindsById[terminalId] ?? null;
  if (currentCliKind === cliKind) {
    return normalized;
  }

  const nextCliKindsById = { ...normalized.terminalCliKindsById };
  if (cliKind === null) {
    delete nextCliKindsById[terminalId];
  } else {
    nextCliKindsById[terminalId] = cliKind;
  }

  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId]?.trim() ?? "";
  const terminalLabelsById =
    cliKind !== null && currentTitleOverride.length === 0
      ? {
          ...normalized.terminalLabelsById,
          [terminalId]: createUniqueTerminalTitle({
            cliKind,
            excludeTerminalId: terminalId,
            terminalLabelsById: normalized.terminalLabelsById,
            terminalTitleOverridesById: normalized.terminalTitleOverridesById,
          }),
        }
      : normalized.terminalLabelsById;

  return {
    ...normalized,
    terminalLabelsById,
    terminalCliKindsById: nextCliKindsById,
  };
}

export function setThreadTerminalTitleOverride(
  state: ThreadTerminalState,
  terminalId: string,
  titleOverride: string | null | undefined,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const normalizedTitleOverride = titleOverride?.trim() ?? "";
  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId] ?? "";
  if (currentTitleOverride === normalizedTitleOverride) {
    return normalized;
  }
  const nextTitleOverridesById = { ...normalized.terminalTitleOverridesById };
  if (normalizedTitleOverride.length === 0) {
    delete nextTitleOverridesById[terminalId];
  } else {
    nextTitleOverridesById[terminalId] = normalizedTitleOverride;
  }
  return {
    ...normalized,
    terminalTitleOverridesById: nextTitleOverridesById,
  };
}

export function setThreadTerminalActivity(
  state: ThreadTerminalState,
  terminalId: string,
  activity: { agentState: TerminalActivityState | null; hasRunningSubprocess: boolean },
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  const nextTerminalAttentionState =
    activity.agentState === "attention" || activity.agentState === "review"
      ? activity.agentState
      : null;
  const currentTerminalAttentionState = normalized.terminalAttentionStatesById[terminalId] ?? null;
  if (
    activity.hasRunningSubprocess === alreadyRunning &&
    nextTerminalAttentionState === currentTerminalAttentionState
  ) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (activity.hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  const terminalAttentionStatesById = { ...normalized.terminalAttentionStatesById };
  if (nextTerminalAttentionState === null) {
    delete terminalAttentionStatesById[terminalId];
  } else {
    terminalAttentionStatesById[terminalId] = nextTerminalAttentionState;
  }
  return {
    ...normalized,
    terminalAttentionStatesById,
    runningTerminalIds: [...runningTerminalIds],
  };
}
