// FILE: storeNormalizedState.ts
// Purpose: Own normalized thread records and their compatibility projections.
// Layer: Web state normalized records

import type { ThreadId } from "@agent-group/contracts";
import { getThreadFromState } from "../threadDerivation";
import type { Project, Thread, ThreadSession, ThreadShell, ThreadTurnState } from "../types";
import { threadSessionsEqual, threadShellsEqual, threadTurnStatesEqual } from "./storeEquality";
import { buildSidebarThreadSummary } from "./storeSidebarProjection";
import {
  EMPTY_ACTIVITY_BY_THREAD,
  EMPTY_ACTIVITY_IDS_BY_THREAD,
  EMPTY_MESSAGE_BY_THREAD,
  EMPTY_MESSAGE_IDS_BY_THREAD,
  EMPTY_PROPOSED_PLAN_BY_THREAD,
  EMPTY_PROPOSED_PLAN_IDS_BY_THREAD,
  EMPTY_THREAD_IDS,
  EMPTY_THREAD_SESSION_BY_ID,
  EMPTY_THREAD_SHELL_BY_ID,
  EMPTY_THREAD_TURN_STATE_BY_ID,
  EMPTY_TURN_DIFF_BY_THREAD,
  EMPTY_TURN_DIFF_IDS_BY_THREAD,
  type AppState,
} from "./storeState";
import {
  buildActivitySlice,
  buildMessageSlice,
  buildProposedPlanSlice,
  buildTurnDiffSlice,
  toThreadShell,
  toThreadTurnState,
  updateThread,
} from "./storeThreadSlices";

function ensureThreadRegistered(state: AppState, threadId: ThreadId): AppState {
  const threadIds = state.threadIds ?? EMPTY_THREAD_IDS;
  if (threadIds.includes(threadId)) return state;
  return { ...state, threadIds: [...threadIds, threadId] };
}

export function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T> | undefined,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  if (!record) return {};
  let changed = false;
  const nextRecord: Record<ThreadId, T> = {};
  for (const [threadId, value] of Object.entries(record) as [ThreadId, T][]) {
    if (!nextThreadIds.has(threadId)) {
      changed = true;
      continue;
    }
    nextRecord[threadId] = value;
  }
  return changed ? nextRecord : record;
}

export function writeThreadShellProjection(
  state: AppState,
  nextThread: {
    shell: ThreadShell;
    session: ThreadSession | null;
    turnState: ThreadTurnState;
  },
): AppState {
  const previousShell = state.threadShellById?.[nextThread.shell.id];
  let nextState = ensureThreadRegistered(state, nextThread.shell.id);

  if (!threadShellsEqual(previousShell, nextThread.shell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...(nextState.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID),
        [nextThread.shell.id]: nextThread.shell,
      },
    };
  }

  if (
    !threadSessionsEqual(
      (nextState.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID)[nextThread.shell.id] ?? null,
      nextThread.session,
    )
  ) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...(nextState.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID),
        [nextThread.shell.id]: nextThread.session,
      },
    };
  }

  if (
    !threadTurnStatesEqual(
      (nextState.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID)[nextThread.shell.id],
      nextThread.turnState,
    )
  ) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...(nextState.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID),
        [nextThread.shell.id]: nextThread.turnState,
      },
    };
  }

  return nextState;
}

export function writeThreadState(
  state: AppState,
  nextThread: Thread,
  previousThread?: Thread,
): AppState {
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById?.[nextThread.id];
  const previousTurnState = state.threadTurnStateById?.[nextThread.id];
  let nextState = ensureThreadRegistered(state, nextThread.id);

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...(nextState.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID),
        [nextThread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(previousThread?.session ?? null, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...(nextState.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID),
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...(nextState.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID),
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== nextThread.messages) {
    const nextSlice = buildMessageSlice(nextThread);
    nextState = {
      ...nextState,
      messageIdsByThreadId: {
        ...(nextState.messageIdsByThreadId ?? EMPTY_MESSAGE_IDS_BY_THREAD),
        [nextThread.id]: nextSlice.ids,
      },
      messageByThreadId: {
        ...(nextState.messageByThreadId ?? EMPTY_MESSAGE_BY_THREAD),
        [nextThread.id]: nextSlice.byId,
      },
    };
  }

  if (previousThread?.activities !== nextThread.activities) {
    const nextSlice = buildActivitySlice(nextThread);
    nextState = {
      ...nextState,
      activityIdsByThreadId: {
        ...(nextState.activityIdsByThreadId ?? EMPTY_ACTIVITY_IDS_BY_THREAD),
        [nextThread.id]: nextSlice.ids,
      },
      activityByThreadId: {
        ...(nextState.activityByThreadId ?? EMPTY_ACTIVITY_BY_THREAD),
        [nextThread.id]: nextSlice.byId,
      },
    };
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const nextSlice = buildProposedPlanSlice(nextThread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...(nextState.proposedPlanIdsByThreadId ?? EMPTY_PROPOSED_PLAN_IDS_BY_THREAD),
        [nextThread.id]: nextSlice.ids,
      },
      proposedPlanByThreadId: {
        ...(nextState.proposedPlanByThreadId ?? EMPTY_PROPOSED_PLAN_BY_THREAD),
        [nextThread.id]: nextSlice.byId,
      },
    };
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const nextSlice = buildTurnDiffSlice(nextThread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...(nextState.turnDiffIdsByThreadId ?? EMPTY_TURN_DIFF_IDS_BY_THREAD),
        [nextThread.id]: nextSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...(nextState.turnDiffSummaryByThreadId ?? EMPTY_TURN_DIFF_BY_THREAD),
        [nextThread.id]: nextSlice.byId,
      },
    };
  }

  return nextState;
}

export function removeThreadState(state: AppState, threadId: ThreadId): AppState {
  const { [threadId]: _shell, ...threadShellById } =
    state.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID;
  const { [threadId]: _session, ...threadSessionById } =
    state.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID;
  const { [threadId]: _turn, ...threadTurnStateById } =
    state.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID;
  const { [threadId]: _messageIds, ...messageIdsByThreadId } =
    state.messageIdsByThreadId ?? EMPTY_MESSAGE_IDS_BY_THREAD;
  const { [threadId]: _messages, ...messageByThreadId } =
    state.messageByThreadId ?? EMPTY_MESSAGE_BY_THREAD;
  const { [threadId]: _activityIds, ...activityIdsByThreadId } =
    state.activityIdsByThreadId ?? EMPTY_ACTIVITY_IDS_BY_THREAD;
  const { [threadId]: _activities, ...activityByThreadId } =
    state.activityByThreadId ?? EMPTY_ACTIVITY_BY_THREAD;
  const { [threadId]: _planIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId ?? EMPTY_PROPOSED_PLAN_IDS_BY_THREAD;
  const { [threadId]: _plans, ...proposedPlanByThreadId } =
    state.proposedPlanByThreadId ?? EMPTY_PROPOSED_PLAN_BY_THREAD;
  const { [threadId]: _diffIds, ...turnDiffIdsByThreadId } =
    state.turnDiffIdsByThreadId ?? EMPTY_TURN_DIFF_IDS_BY_THREAD;
  const { [threadId]: _diffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId ?? EMPTY_TURN_DIFF_BY_THREAD;
  const { [threadId]: _summary, ...sidebarThreadSummaryById } = state.sidebarThreadSummaryById;
  const nextThreadIds = (state.threadIds ?? EMPTY_THREAD_IDS).filter((id) => id !== threadId);
  const nextThreads = state.threads.filter((thread) => thread.id !== threadId);

  return {
    ...state,
    threadIds: nextThreadIds,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
    threads: nextThreads,
  };
}

export function removeDeletedThreadFromClientState(state: AppState, threadId: ThreadId): AppState {
  const deletedThreadIdsById =
    state.deletedThreadIdsById?.[threadId] === true
      ? state.deletedThreadIdsById
      : { ...(state.deletedThreadIdsById ?? {}), [threadId]: true };
  const nextState = removeThreadState(state, threadId);
  return nextState.deletedThreadIdsById === deletedThreadIdsById
    ? nextState
    : { ...nextState, deletedThreadIdsById };
}

export function removeProjectState(state: AppState, projectId: Project["id"]): AppState {
  const threadIds = new Set<ThreadId>();
  for (const thread of state.threads) {
    if (thread.projectId === projectId) threadIds.add(thread.id);
  }
  for (const shell of Object.values(state.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID)) {
    if (shell.projectId === projectId) threadIds.add(shell.id);
  }

  const nextProjects = state.projects.some((project) => project.id === projectId)
    ? state.projects.filter((project) => project.id !== projectId)
    : state.projects;
  const nextState = [...threadIds].reduce(
    (currentState, threadId) => removeThreadState(currentState, threadId),
    state,
  );
  if (nextProjects === state.projects && nextState === state) return state;
  return nextProjects === nextState.projects ? nextState : { ...nextState, projects: nextProjects };
}

export function removeDeletedProjectFromClientState(
  state: AppState,
  projectId: Project["id"],
): AppState {
  const deletedProjectIdsById =
    state.deletedProjectIdsById?.[projectId] === true
      ? state.deletedProjectIdsById
      : { ...(state.deletedProjectIdsById ?? {}), [projectId]: true };
  const nextState = removeProjectState(state, projectId);
  return nextState.deletedProjectIdsById === deletedProjectIdsById
    ? nextState
    : { ...nextState, deletedProjectIdsById };
}

export function commitThreadProjection(
  state: AppState,
  threadId: ThreadId,
  options?: { updateThreadArray?: boolean; updateSidebarSummary?: boolean },
): AppState {
  const nextThread = getThreadFromState(state, threadId);
  const previousThread = state.threads.find((thread) => thread.id === threadId);
  if (!nextThread) return state;

  const shouldUpdateThreadArray = options?.updateThreadArray ?? true;
  const shouldUpdateSidebarSummary = options?.updateSidebarSummary ?? true;
  const threads = shouldUpdateThreadArray
    ? previousThread
      ? updateThread(state.threads, threadId, (thread) =>
          nextThread === thread ? thread : nextThread,
        )
      : [...state.threads, nextThread]
    : state.threads;
  const previousSummary = state.sidebarThreadSummaryById[threadId];
  const nextSummary =
    shouldUpdateSidebarSummary || previousSummary === undefined
      ? buildSidebarThreadSummary(nextThread, previousSummary)
      : previousSummary;

  if (threads === state.threads && nextSummary === previousSummary) return state;
  return {
    ...state,
    threads,
    sidebarThreadSummaryById:
      nextSummary === previousSummary || nextSummary === undefined
        ? state.sidebarThreadSummaryById
        : { ...state.sidebarThreadSummaryById, [threadId]: nextSummary },
  };
}
