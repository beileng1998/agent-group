// FILE: -automations.shared.tsx
// Purpose: Preserves the shared automation feature API across route modules.
// Layer: Automation web feature facade

export {
  acknowledgedRiskIdsForFormWarnings,
  applyScheduleToForm,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  datetimeLocalFromIso,
  defaultModelSelection,
  formatCadence,
  formatClockTime,
  formatDateTime,
  formatSchedule,
  formFromDefinition,
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
  isFormSubmittable,
  isoFromDatetimeLocal,
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  scheduleFromForm,
  scheduleFromKind,
  scheduleKindFromSchedule,
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  updateInputFromForm,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
  type AutomationFormState,
  type IntervalUnit,
  type ScheduleKind,
} from "~/lib/automationForm";

export { AutomationApprovalBanner } from "./-automations/AutomationApprovalBanner";
export { AutomationDialog } from "./-automations/AutomationDialog";
export { AutomationModelPicker } from "./-automations/AutomationModelPicker";
export {
  EMPTY_AUTOMATION_LIST,
  applyAutomationEvent,
  automationQueryKey,
} from "./-automations/automationCache";
export { maxIterationOptions } from "./-automations/automationCadence";
export {
  AUTOMATION_TEMPLATES,
  RunStatusIndicator,
  allVisibleTriageRuns,
  automationAttentionCount,
  automationStatusDotClass,
  canCancelAutomationRun,
  formatRelativeTime,
  isRowInteractiveEventTarget,
  isTriageRun,
  isUnresolvedTriageResult,
  runResultSummary,
  runStatusDotClassName,
  runStatusLabel,
  runStatusVariant,
  unresolvedTriageRuns,
} from "./-automations/automationPresentation";
export { useAutomations } from "./-automations/useAutomations";
