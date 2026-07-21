// FILE: automationForm.ts
// Purpose: Preserves the public automation form helper import path.
// Layer: Web lib compatibility facade

export {
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  defaultModelSelection,
} from "./automation-form/automationFormTypes";
export type {
  AutomationFormState,
  AutomationProjectModelSelectionSource,
  IntervalUnit,
  ScheduleKind,
} from "./automation-form/automationFormTypes";
export {
  datetimeLocalFromIso,
  formatCadence,
  formatClockTime,
  formatDateTime,
  formatSchedule,
  isoFromDatetimeLocal,
  scheduleFromKind,
  scheduleKindFromSchedule,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
} from "./automation-form/automationSchedule";
export {
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
} from "./automation-form/automationHeartbeat";
export {
  applyScheduleToForm,
  formFromDefinition,
  scheduleFromForm,
} from "./automation-form/automationFormState";
export {
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
} from "./automation-form/automationModelSelection";
export {
  acknowledgedRiskIdsForFormWarnings,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  isFormSubmittable,
  updateInputFromForm,
} from "./automation-form/automationFormPayload";
