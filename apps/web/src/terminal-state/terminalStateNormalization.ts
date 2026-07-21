import type { ThreadId } from "@agent-group/contracts";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  type ThreadTerminalGroup,
} from "../types";
import {
  collectTerminalIdsFromLayout,
  createTerminalGroup,
  normalizeTerminalPaneGroup,
  setActiveTerminalInGroupLayout,
} from "../terminalPaneLayout";
import {
  ensureTerminalLabels,
  normalizeRunningTerminalIds,
  normalizeTerminalAttentionStates,
  normalizeTerminalCliKinds,
  normalizeTerminalIds,
  normalizeTerminalLabels,
  normalizeTerminalTitleOverrides,
} from "./terminalStateIdentity";
import type { ThreadTerminalState } from "./terminalStateTypes";

export function fallbackGroupId(terminalId: string): string {
  return `group-${terminalId}`;
}

export function assignUniqueGroupId(baseId: string, usedGroupIds: Set<string>): string {
  let candidate = baseId;
  let index = 2;
  while (usedGroupIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  usedGroupIds.add(candidate);
  return candidate;
}

export function findGroupIndexByTerminalId(
  terminalGroups: ThreadTerminalGroup[],
  terminalId: string,
): number {
  return terminalGroups.findIndex((group) =>
    collectTerminalIdsFromLayout(group.layout).includes(terminalId),
  );
}

function normalizeTerminalGroups(
  terminalGroups: ThreadTerminalGroup[],
  terminalIds: string[],
): ThreadTerminalGroup[] {
  const nextGroups: ThreadTerminalGroup[] = [];
  const assignedTerminalIds = new Set<string>();
  const usedGroupIds = new Set<string>();

  for (const group of terminalGroups) {
    const normalizedGroup = normalizeTerminalPaneGroup(group, terminalIds);
    if (!normalizedGroup) continue;
    const unassignedTerminalIds = collectTerminalIdsFromLayout(normalizedGroup.layout).filter(
      (terminalId) => {
        if (assignedTerminalIds.has(terminalId)) return false;
        return true;
      },
    );
    if (unassignedTerminalIds.length === 0) continue;
    const normalizedUnassignedGroup = normalizeTerminalPaneGroup(
      {
        ...normalizedGroup,
        layout: normalizedGroup.layout,
      },
      unassignedTerminalIds,
    );
    if (!normalizedUnassignedGroup) continue;
    collectTerminalIdsFromLayout(normalizedUnassignedGroup.layout).forEach((terminalId) => {
      assignedTerminalIds.add(terminalId);
    });
    nextGroups.push({
      ...normalizedUnassignedGroup,
      id: assignUniqueGroupId(
        normalizedUnassignedGroup.id.trim() ||
          fallbackGroupId(unassignedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID),
        usedGroupIds,
      ),
    });
  }

  for (const terminalId of terminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextGroups.push(
      createTerminalGroup(
        assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
        terminalId,
      ),
    );
  }

  if (nextGroups.length === 0) {
    return [
      createTerminalGroup(fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID), DEFAULT_THREAD_TERMINAL_ID),
    ];
  }

  return nextGroups;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function terminalGroupsEqual(
  left: ThreadTerminalGroup[],
  right: ThreadTerminalGroup[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftGroup = left[index];
    const rightGroup = right[index];
    if (!leftGroup || !rightGroup) return false;
    if (leftGroup.id !== rightGroup.id) return false;
    if (leftGroup.activeTerminalId !== rightGroup.activeTerminalId) return false;
    if (JSON.stringify(leftGroup.layout) !== JSON.stringify(rightGroup.layout)) return false;
  }
  return true;
}

function threadTerminalStateEqual(left: ThreadTerminalState, right: ThreadTerminalState): boolean {
  return (
    left.entryPoint === right.entryPoint &&
    left.terminalOpen === right.terminalOpen &&
    left.presentationMode === right.presentationMode &&
    left.workspaceLayout === right.workspaceLayout &&
    left.workspaceActiveTab === right.workspaceActiveTab &&
    left.terminalHeight === right.terminalHeight &&
    left.activeTerminalId === right.activeTerminalId &&
    left.activeTerminalGroupId === right.activeTerminalGroupId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    JSON.stringify(left.terminalLabelsById) === JSON.stringify(right.terminalLabelsById) &&
    JSON.stringify(left.terminalTitleOverridesById) ===
      JSON.stringify(right.terminalTitleOverridesById) &&
    JSON.stringify(left.terminalCliKindsById) === JSON.stringify(right.terminalCliKindsById) &&
    JSON.stringify(left.terminalAttentionStatesById) ===
      JSON.stringify(right.terminalAttentionStatesById) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds) &&
    terminalGroupsEqual(left.terminalGroups, right.terminalGroups)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: ThreadTerminalState = Object.freeze({
  entryPoint: "chat",
  terminalOpen: false,
  presentationMode: "drawer",
  workspaceLayout: "both",
  workspaceActiveTab: "terminal",
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  terminalLabelsById: { [DEFAULT_THREAD_TERMINAL_ID]: "Terminal 1" },
  terminalTitleOverridesById: {},
  terminalCliKindsById: {},
  terminalAttentionStatesById: {},
  runningTerminalIds: [],
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
  terminalGroups: [
    createTerminalGroup(fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID), DEFAULT_THREAD_TERMINAL_ID),
  ],
  activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
});

export function copyTerminalGroups(groups: ThreadTerminalGroup[]): ThreadTerminalGroup[] {
  return groups.map((group) => ({
    ...group,
    layout: JSON.parse(JSON.stringify(group.layout)),
  }));
}

export function createDefaultThreadTerminalState(): ThreadTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    terminalLabelsById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalLabelsById },
    terminalTitleOverridesById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalTitleOverridesById },
    terminalCliKindsById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalCliKindsById },
    terminalAttentionStatesById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalAttentionStatesById },
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
    terminalGroups: copyTerminalGroups(DEFAULT_THREAD_TERMINAL_STATE.terminalGroups),
  };
}

export function getDefaultThreadTerminalState(): ThreadTerminalState {
  return DEFAULT_THREAD_TERMINAL_STATE;
}

export function normalizeThreadTerminalState(state: ThreadTerminalState): ThreadTerminalState {
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds.length > 0 ? terminalIds : [DEFAULT_THREAD_TERMINAL_ID];
  const terminalLabelsById = normalizeTerminalLabels(
    (state as Partial<ThreadTerminalState>).terminalLabelsById,
    nextTerminalIds,
  );
  const terminalTitleOverridesById = normalizeTerminalTitleOverrides(
    (state as Partial<ThreadTerminalState>).terminalTitleOverridesById,
    nextTerminalIds,
  );
  const terminalCliKindsById = normalizeTerminalCliKinds(
    (state as Partial<ThreadTerminalState>).terminalCliKindsById,
    nextTerminalIds,
  );
  const terminalAttentionStatesById = normalizeTerminalAttentionStates(
    (state as Partial<ThreadTerminalState>).terminalAttentionStatesById,
    nextTerminalIds,
  );
  const ensuredTerminalLabelsById = ensureTerminalLabels({
    terminalCliKindsById,
    terminalIds: nextTerminalIds,
    terminalLabelsById,
    terminalTitleOverridesById,
  });
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalGroups = normalizeTerminalGroups(state.terminalGroups, nextTerminalIds);
  const activeGroupIdFromState = terminalGroups.some(
    (group) => group.id === state.activeTerminalGroupId,
  )
    ? state.activeTerminalGroupId
    : null;
  const activeGroupIdFromTerminal =
    terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(activeTerminalId),
    )?.id ?? null;
  const resolvedActiveTerminalGroupId =
    activeGroupIdFromState ??
    activeGroupIdFromTerminal ??
    terminalGroups[0]?.id ??
    fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID);
  const syncedTerminalGroups = terminalGroups.map((group) =>
    group.id === resolvedActiveTerminalGroupId &&
    collectTerminalIdsFromLayout(group.layout).includes(activeTerminalId) &&
    group.activeTerminalId !== activeTerminalId
      ? setActiveTerminalInGroupLayout(group, activeTerminalId)
      : group,
  );

  const normalized: ThreadTerminalState = {
    entryPoint: state.entryPoint === "terminal" ? "terminal" : "chat",
    terminalOpen: state.terminalOpen,
    presentationMode: state.presentationMode === "workspace" ? "workspace" : "drawer",
    workspaceLayout: state.workspaceLayout === "terminal-only" ? "terminal-only" : "both",
    workspaceActiveTab: state.workspaceActiveTab === "chat" ? "chat" : "terminal",
    terminalHeight:
      Number.isFinite(state.terminalHeight) && state.terminalHeight > 0
        ? state.terminalHeight
        : DEFAULT_THREAD_TERMINAL_HEIGHT,
    terminalIds: nextTerminalIds,
    terminalLabelsById: ensuredTerminalLabelsById,
    terminalTitleOverridesById,
    terminalCliKindsById,
    terminalAttentionStatesById,
    runningTerminalIds,
    activeTerminalId,
    terminalGroups: syncedTerminalGroups,
    activeTerminalGroupId: resolvedActiveTerminalGroupId,
  };
  return threadTerminalStateEqual(state, normalized) ? state : normalized;
}

export function isDefaultThreadTerminalState(state: ThreadTerminalState): boolean {
  const normalized = normalizeThreadTerminalState(state);
  return threadTerminalStateEqual(normalized, DEFAULT_THREAD_TERMINAL_STATE);
}

function stripVolatileTerminalRuntimeState(state: ThreadTerminalState): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (
    normalized.runningTerminalIds.length === 0 &&
    Object.keys(normalized.terminalAttentionStatesById).length === 0
  ) {
    return normalized;
  }
  // Runtime activity is replayed by live terminal events after startup; persisting
  // it would make old attention states look like fresh notifications.
  return {
    ...normalized,
    terminalAttentionStatesById: {},
    runningTerminalIds: [],
  };
}

export function sanitizePersistedTerminalStateByThreadId(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState> | null | undefined,
): Record<ThreadId, ThreadTerminalState> {
  const next: Record<ThreadId, ThreadTerminalState> = {};
  for (const [threadId, state] of Object.entries(terminalStateByThreadId ?? {})) {
    const sanitized = stripVolatileTerminalRuntimeState(state);
    if (!isDefaultThreadTerminalState(sanitized)) {
      next[threadId as ThreadId] = sanitized;
    }
  }
  return next;
}

export function selectThreadTerminalState(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId,
): ThreadTerminalState {
  if (threadId.length === 0) {
    return getDefaultThreadTerminalState();
  }
  return terminalStateByThreadId[threadId] ?? getDefaultThreadTerminalState();
}

export function updateTerminalStateByThreadId(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
): Record<ThreadId, ThreadTerminalState> {
  if (threadId.length === 0) {
    return terminalStateByThreadId;
  }

  const current = selectThreadTerminalState(terminalStateByThreadId, threadId);
  const next = updater(current);
  if (next === current) {
    return terminalStateByThreadId;
  }

  if (isDefaultThreadTerminalState(next)) {
    if (terminalStateByThreadId[threadId] === undefined) {
      return terminalStateByThreadId;
    }
    const { [threadId]: _removed, ...rest } = terminalStateByThreadId;
    return rest as Record<ThreadId, ThreadTerminalState>;
  }

  return {
    ...terminalStateByThreadId,
    [threadId]: next,
  };
}
