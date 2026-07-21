// FILE: storeState.ts
// Purpose: Define normalized web store state, event aliases, stable empty values, and limits.
// Layer: Web state contracts

import type {
  MessageId,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import type {
  ChatMessage,
  Project,
  SidebarThreadSummary,
  Thread,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
} from "../types";

export interface AppState {
  projects: Project[];
  threads: Thread[];
  sidebarThreadSummaryById: Record<string, SidebarThreadSummary>;
  threadsHydrated: boolean;
  threadIds?: ThreadId[];
  threadShellById?: Record<ThreadId, ThreadShell>;
  threadSessionById?: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById?: Record<ThreadId, ThreadTurnState>;
  messageIdsByThreadId?: Record<ThreadId, MessageId[]>;
  messageByThreadId?: Record<ThreadId, Record<MessageId, ChatMessage>>;
  activityIdsByThreadId?: Record<ThreadId, string[]>;
  activityByThreadId?: Record<ThreadId, Record<string, Thread["activities"][number]>>;
  proposedPlanIdsByThreadId?: Record<ThreadId, string[]>;
  proposedPlanByThreadId?: Record<ThreadId, Record<string, Thread["proposedPlans"][number]>>;
  turnDiffIdsByThreadId?: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId?: Record<ThreadId, Record<TurnId, Thread["turnDiffSummaries"][number]>>;
  deletedProjectIdsById?: Record<Project["id"], true>;
  deletedThreadIdsById?: Record<ThreadId, true>;
}

export type ReadModelProject = OrchestrationReadModel["projects"][number];
export type ReadModelThread = OrchestrationReadModel["threads"][number];
export type ReadModelMessage = OrchestrationReadModel["threads"][number]["messages"][number];
export type ShellSnapshotProject = OrchestrationShellSnapshot["projects"][number];
export type ShellSnapshotThread = OrchestrationShellSnapshot["threads"][number];
export type ThreadMessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;
export type ThreadActivityAppendedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" }
>;
export type ThreadApprovalResponseRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.approval-response-requested" }
>;
export type ThreadUserInputResponseRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.user-input-response-requested" }
>;
export type ApplyOrchestrationEventOptions = {
  updateThreadArray?: boolean;
  updateSidebarSummary?: boolean;
};

export const MAX_THREAD_MESSAGES = 2_000;
export const MAX_THREAD_ACTIVITIES = 500;
export const EMPTY_THREAD_IDS: ThreadId[] = [];
Object.freeze(EMPTY_THREAD_IDS);
export const EMPTY_THREAD_SHELL_BY_ID: Record<ThreadId, ThreadShell> = {};
export const EMPTY_THREAD_SESSION_BY_ID: Record<ThreadId, ThreadSession | null> = {};
export const EMPTY_THREAD_TURN_STATE_BY_ID: Record<ThreadId, ThreadTurnState> = {};
export const EMPTY_MESSAGE_IDS_BY_THREAD: Record<ThreadId, MessageId[]> = {};
export const EMPTY_MESSAGE_BY_THREAD: Record<ThreadId, Record<MessageId, ChatMessage>> = {};
export const EMPTY_ACTIVITY_IDS_BY_THREAD: Record<ThreadId, string[]> = {};
export const EMPTY_ACTIVITY_BY_THREAD: Record<
  ThreadId,
  Record<string, Thread["activities"][number]>
> = {};
export const EMPTY_PROPOSED_PLAN_IDS_BY_THREAD: Record<ThreadId, string[]> = {};
export const EMPTY_PROPOSED_PLAN_BY_THREAD: Record<
  ThreadId,
  Record<string, Thread["proposedPlans"][number]>
> = {};
export const EMPTY_TURN_DIFF_IDS_BY_THREAD: Record<ThreadId, TurnId[]> = {};
export const EMPTY_TURN_DIFF_BY_THREAD: Record<
  ThreadId,
  Record<TurnId, Thread["turnDiffSummaries"][number]>
> = {};

export const THREAD_SUMMARY_ACTIVITY_KINDS = new Set([
  "approval.requested",
  "approval.resolved",
  "provider.approval.respond.failed",
  "user-input.requested",
  "user-input.resolved",
  "provider.user-input.respond.failed",
]);
export const PENDING_INTERACTION_REQUEST_KINDS = new Set([
  "approval.requested",
  "user-input.requested",
]);

export const initialState: AppState = {
  projects: [],
  threads: [],
  sidebarThreadSummaryById: {},
  threadsHydrated: false,
  threadIds: [],
  threadShellById: {},
  threadSessionById: {},
  threadTurnStateById: {},
  messageIdsByThreadId: {},
  messageByThreadId: {},
  activityIdsByThreadId: {},
  activityByThreadId: {},
  proposedPlanIdsByThreadId: {},
  proposedPlanByThreadId: {},
  turnDiffIdsByThreadId: {},
  turnDiffSummaryByThreadId: {},
  deletedProjectIdsById: {},
  deletedThreadIdsById: {},
};
