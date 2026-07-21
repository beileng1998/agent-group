import {
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
  type ThreadTerminalSplitPosition,
} from "../types";
import {
  addTerminalTabToGroupLayout,
  collectTerminalIdsFromLayout,
  createTerminalGroup,
  removeTerminalFromGroupLayout,
  resizeTerminalGroupLayout,
  setActiveTerminalInGroupLayout,
  splitTerminalGroupLayout,
} from "../terminalPaneLayout";
import {
  createWorkspaceTerminalGroupFromPreset,
  type WorkspaceLayoutPresetId,
} from "../workspaceTerminalLayoutPresets";
import {
  clearTerminalReviewState,
  ensureTerminalLabels,
  isValidTerminalId,
  normalizeRunningTerminalIds,
  normalizeTerminalAttentionStates,
  normalizeTerminalCliKinds,
  normalizeTerminalIds,
  normalizeTerminalLabels,
  normalizeTerminalTitleOverrides,
} from "./terminalStateIdentity";
import {
  assignUniqueGroupId,
  copyTerminalGroups,
  createDefaultThreadTerminalState,
  fallbackGroupId,
  findGroupIndexByTerminalId,
  normalizeThreadTerminalState,
  terminalGroupsEqual,
} from "./terminalStateNormalization";
import type { ThreadTerminalState } from "./terminalStateTypes";

function upsertTerminalIntoGroups(
  state: ThreadTerminalState,
  terminalId: string,
  mode: "split" | "new",
  position: ThreadTerminalSplitPosition = "right",
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId)) {
    return normalized;
  }

  const isNewTerminal = !normalized.terminalIds.includes(terminalId);
  const terminalIds = isNewTerminal
    ? [...normalized.terminalIds, terminalId]
    : normalized.terminalIds;
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);

  const existingGroupIndex = findGroupIndexByTerminalId(terminalGroups, terminalId);
  if (existingGroupIndex >= 0) {
    const existingGroup = terminalGroups[existingGroupIndex];
    if (existingGroup) {
      const nextExistingGroup = removeTerminalFromGroupLayout(existingGroup, terminalId);
      if (nextExistingGroup) {
        terminalGroups[existingGroupIndex] = nextExistingGroup;
      } else {
        terminalGroups.splice(existingGroupIndex, 1);
      }
    }
  }

  if (mode === "new") {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds);
    terminalGroups.push(createTerminalGroup(nextGroupId, terminalId));
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds,
      activeTerminalId: terminalId,
      terminalGroups,
      activeTerminalGroupId: nextGroupId,
    });
  }

  let activeGroupIndex = terminalGroups.findIndex(
    (group) => group.id === normalized.activeTerminalGroupId,
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(
      fallbackGroupId(normalized.activeTerminalId),
      usedGroupIds,
    );
    terminalGroups.push(createTerminalGroup(nextGroupId, normalized.activeTerminalId));
    activeGroupIndex = terminalGroups.length - 1;
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }
  const destinationTerminalIds = collectTerminalIdsFromLayout(destinationGroup.layout);

  if (
    isNewTerminal &&
    !destinationTerminalIds.includes(terminalId) &&
    destinationTerminalIds.length >= MAX_TERMINALS_PER_GROUP
  ) {
    return normalized;
  }

  if (!destinationTerminalIds.includes(terminalId)) {
    terminalGroups[activeGroupIndex] = splitTerminalGroupLayout({
      group: destinationGroup,
      targetTerminalId: normalized.activeTerminalId,
      newTerminalId: terminalId,
      position,
      splitId: `split-${terminalId}`,
    });
  }

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: terminalGroups[activeGroupIndex]?.id ?? destinationGroup.id,
  });
}

export function splitThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split", "right");
}

export function splitThreadTerminalLeft(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split", "left");
}

export function splitThreadTerminalDown(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split", "bottom");
}

export function splitThreadTerminalUp(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split", "top");
}

export function newThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "new");
}

export function newThreadTerminalTab(
  state: ThreadTerminalState,
  targetTerminalId: string,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId) || normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);
  let activeGroupIndex = terminalGroups.findIndex((group) =>
    collectTerminalIdsFromLayout(group.layout).includes(targetTerminalId),
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    return newThreadTerminal(normalized, terminalId);
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }
  const destinationTerminalIds = collectTerminalIdsFromLayout(destinationGroup.layout);
  if (destinationTerminalIds.length >= MAX_TERMINALS_PER_GROUP) {
    return normalized;
  }

  terminalGroups[activeGroupIndex] = addTerminalTabToGroupLayout(
    destinationGroup,
    targetTerminalId,
    terminalId,
  );

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds: [...normalized.terminalIds, terminalId],
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: terminalGroups[activeGroupIndex]?.id ?? destinationGroup.id,
  });
}

export function setThreadActiveTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const activeTerminalGroupId =
    normalized.terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(terminalId),
    )?.id ?? normalized.activeTerminalGroupId;
  const terminalGroups = normalized.terminalGroups.map((group) =>
    group.id === activeTerminalGroupId ? setActiveTerminalInGroupLayout(group, terminalId) : group,
  );
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.activeTerminalGroupId === activeTerminalGroupId &&
    terminalGroupsEqual(terminalGroups, normalized.terminalGroups) &&
    normalized.terminalAttentionStatesById[terminalId] !== "review"
  ) {
    return normalized;
  }
  return {
    ...normalized,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId,
    terminalAttentionStatesById: clearTerminalReviewState(
      normalized.terminalAttentionStatesById,
      terminalId,
    ),
  };
}

export function closeThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    if (normalized.entryPoint === "terminal") {
      return normalizeThreadTerminalState({
        ...createDefaultThreadTerminalState(),
        entryPoint: "terminal",
        terminalOpen: false,
        presentationMode: normalized.presentationMode,
        workspaceLayout: normalized.workspaceLayout,
        workspaceActiveTab: "terminal",
        terminalHeight: normalized.terminalHeight,
      });
    }
    return createDefaultThreadTerminalState();
  }

  const sourceGroupId =
    normalized.terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(terminalId),
    )?.id ?? normalized.activeTerminalGroupId;

  const terminalGroups = normalized.terminalGroups
    .map((group) => removeTerminalFromGroupLayout(group, terminalId))
    .filter((group): group is ThreadTerminalGroup => group !== null);

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (terminalGroups.find((group) => group.id === sourceGroupId)?.activeTerminalId ??
        remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        remainingTerminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;

  const nextActiveTerminalGroupId =
    terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(nextActiveTerminalId),
    )?.id ??
    terminalGroups[0]?.id ??
    fallbackGroupId(nextActiveTerminalId);

  return normalizeThreadTerminalState({
    entryPoint: normalized.entryPoint,
    terminalOpen: normalized.terminalOpen,
    presentationMode: normalized.presentationMode,
    workspaceLayout: normalized.workspaceLayout,
    workspaceActiveTab: normalized.workspaceActiveTab,
    terminalHeight: normalized.terminalHeight,
    terminalIds: remainingTerminalIds,
    terminalLabelsById: Object.fromEntries(
      Object.entries(normalized.terminalLabelsById).filter(([id]) => id !== terminalId),
    ),
    terminalTitleOverridesById: Object.fromEntries(
      Object.entries(normalized.terminalTitleOverridesById).filter(([id]) => id !== terminalId),
    ),
    terminalCliKindsById: Object.fromEntries(
      Object.entries(normalized.terminalCliKindsById).filter(([id]) => id !== terminalId),
    ),
    terminalAttentionStatesById: Object.fromEntries(
      Object.entries(normalized.terminalAttentionStatesById).filter(([id]) => id !== terminalId),
    ),
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    activeTerminalId: nextActiveTerminalId,
    terminalGroups,
    activeTerminalGroupId: nextActiveTerminalGroupId,
  });
}

export function closeThreadTerminalGroup(
  state: ThreadTerminalState,
  groupId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const group = normalized.terminalGroups.find((entry) => entry.id === groupId);
  if (!group) {
    return normalized;
  }
  const terminalIds = collectTerminalIdsFromLayout(group.layout);
  return terminalIds.reduce(
    (nextState, terminalId) => closeThreadTerminal(nextState, terminalId),
    normalized,
  );
}

export function resizeThreadTerminalSplit(
  state: ThreadTerminalState,
  groupId: string,
  splitId: string,
  weights: number[],
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const groupIndex = normalized.terminalGroups.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return normalized;
  }
  const group = normalized.terminalGroups[groupIndex];
  if (!group) {
    return normalized;
  }
  const nextGroup = resizeTerminalGroupLayout(group, splitId, weights);
  if (nextGroup === group) {
    return normalized;
  }
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);
  terminalGroups[groupIndex] = nextGroup;
  return normalizeThreadTerminalState({
    ...normalized,
    terminalGroups,
  });
}

export function openThreadTerminalFullWidth(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const nextState = newThreadTerminal(state, terminalId);
  return normalizeThreadTerminalState({
    ...nextState,
    terminalOpen: true,
    presentationMode: "workspace",
    workspaceLayout: "terminal-only",
    workspaceActiveTab: "terminal",
    activeTerminalId: terminalId,
  });
}

export function applyThreadWorkspaceLayoutPreset(
  state: ThreadTerminalState,
  presetId: WorkspaceLayoutPresetId,
  terminalIds: readonly string[],
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const nextTerminalIds = normalizeTerminalIds([...terminalIds]);
  const activeTerminalId = nextTerminalIds.includes(normalized.activeTerminalId)
    ? normalized.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalLabelsById = ensureTerminalLabels({
    terminalCliKindsById: normalizeTerminalCliKinds(
      normalized.terminalCliKindsById,
      nextTerminalIds,
    ),
    terminalIds: nextTerminalIds,
    terminalLabelsById: normalizeTerminalLabels(normalized.terminalLabelsById, nextTerminalIds),
    terminalTitleOverridesById: normalizeTerminalTitleOverrides(
      normalized.terminalTitleOverridesById,
      nextTerminalIds,
    ),
  });
  const terminalTitleOverridesById = normalizeTerminalTitleOverrides(
    normalized.terminalTitleOverridesById,
    nextTerminalIds,
  );
  const terminalCliKindsById = normalizeTerminalCliKinds(
    normalized.terminalCliKindsById,
    nextTerminalIds,
  );
  const terminalGroup = createWorkspaceTerminalGroupFromPreset({
    presetId,
    terminalIds: nextTerminalIds,
    activeTerminalId,
  });

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    presentationMode: "workspace",
    workspaceLayout: "terminal-only",
    workspaceActiveTab: "terminal",
    terminalIds: nextTerminalIds,
    terminalLabelsById,
    terminalTitleOverridesById,
    terminalCliKindsById,
    terminalAttentionStatesById: normalizeTerminalAttentionStates(
      normalized.terminalAttentionStatesById,
      nextTerminalIds,
    ),
    runningTerminalIds: normalizeRunningTerminalIds(normalized.runningTerminalIds, nextTerminalIds),
    activeTerminalId,
    terminalGroups: [terminalGroup],
    activeTerminalGroupId: terminalGroup.id,
  });
}
