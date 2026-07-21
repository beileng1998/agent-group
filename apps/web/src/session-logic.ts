// FILE: session-logic.ts
// Purpose: Compatibility facade for session read models and work-log projection.
// Layer: Web public session logic API

export {
  PROVIDER_OPTIONS,
  WORK_LOG_PRESENTATION_VERSION,
  isFileChangeWorkLogEntry,
  isProviderFileEditWorkLogEntry,
} from "./sessionTypes";
export type {
  ActiveBackgroundTasksState,
  ActiveTaskListState,
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
  ProviderPickerKind,
  TimelineEntry,
  WorkLogAutomation,
  WorkLogEntry,
  WorkLogSubagent,
  WorkLogSubagentAction,
} from "./sessionTypes";
export {
  canSessionAnswerPendingRequests,
  deriveActiveWorkStartedAt,
  derivePhase,
  formatClockDuration,
  formatClockElapsed,
  formatElapsed,
  hasLiveLatestTurn,
  isLatestTurnSettled,
  isSessionRunningTurn,
  isThreadRunningTurn,
} from "./sessionTiming";
export { derivePendingApprovals, derivePendingUserInputs } from "./sessionPendingState";
export {
  deriveActiveBackgroundTasksState,
  deriveActiveTaskListState,
  hasLiveTurnTailWork,
} from "./sessionTaskState";
export {
  buildSourceProposedPlanReference,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
} from "./sessionPlanState";
export { deriveWorkLogEntries } from "./sessionWorkLogProjection";
export { deriveTimelineEntries, inferCheckpointTurnCountByTurnId } from "./sessionTimeline";
