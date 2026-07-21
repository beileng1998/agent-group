import {
  DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS,
  DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS,
} from "@agent-group/contracts";
import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationUpdateInput,
  ProjectId,
  ProviderStartOptions,
  ThreadId,
} from "@agent-group/contracts";

import { completionPolicyFromStopWhen } from "../automationCompletionPolicy";
import {
  acknowledgedRiskIdsForDraft,
  buildAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "../automationDraft";
import { maxIterationsFromForm, scheduleFromForm } from "./automationFormState";
import { TIME_OF_DAY_PATTERN, type AutomationFormState } from "./automationFormTypes";

export function automationFastIntervalLimitMessage(form: AutomationFormState): string | null {
  const schedule = scheduleFromForm(form);
  const maxIterations = maxIterationsFromForm(form);
  if (
    schedule.type === "interval" &&
    schedule.everySeconds < DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS &&
    (maxIterations === null || maxIterations > DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS)
  ) {
    return `Intervals under one minute need max iterations set to ${DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS} runs or fewer.`;
  }
  return null;
}

export function createInputFromForm(
  form: AutomationFormState,
  providerOptions?: ProviderStartOptions,
  acknowledgedRisks?: AutomationCreateInput["acknowledgedRisks"],
  sourceThreadId?: ThreadId | null,
): AutomationCreateInput {
  const maxIterations = maxIterationsFromForm(form);
  const stopWhen = form.stopWhen.trim();
  return {
    name: form.name.trim(),
    projectId: form.projectId as ProjectId,
    ...(sourceThreadId !== undefined ? { sourceThreadId } : {}),
    prompt: form.prompt.trim(),
    schedule: scheduleFromForm(form),
    enabled: form.enabled,
    modelSelection: form.modelSelection,
    runtimeMode: form.runtimeMode,
    interactionMode: "default",
    worktreeMode: form.worktreeMode,
    ...(providerOptions ? { providerOptions } : {}),
    mode: form.mode,
    targetThreadId: form.mode === "heartbeat" ? (form.targetThreadId as ThreadId) : null,
    maxIterations,
    ...(form.mode === "heartbeat"
      ? {
          stopOnError: form.stopOnError,
          completionPolicy: completionPolicyFromStopWhen(stopWhen),
        }
      : { completionPolicy: { type: "none" as const } }),
    ...(acknowledgedRisks ? { acknowledgedRisks } : {}),
  };
}

export function updateInputFromForm(
  definition: AutomationDefinition,
  form: AutomationFormState,
  providerOptions?: ProviderStartOptions,
  acknowledgedRisks?: AutomationCreateInput["acknowledgedRisks"],
): AutomationUpdateInput {
  return {
    id: definition.id,
    ...createInputFromForm(form, providerOptions, acknowledgedRisks),
  };
}

export function buildAutomationFormWarnings(form: AutomationFormState) {
  return buildAutomationDraftWarnings({
    schedule: scheduleFromForm(form),
    mode: form.mode,
    runtimeMode: form.runtimeMode,
    worktreeMode: form.worktreeMode,
    hasEphemeralContext: false,
    generatedConfidence: null,
    generatedNeedsConfirmation: false,
    prompt: form.prompt,
  });
}

export function acknowledgedRiskIdsForFormWarnings(
  warnings: readonly AutomationDraftWarning[],
  acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>,
) {
  return acknowledgedRiskIdsForDraft(warnings, acknowledgedWarningIds);
}

export function isFormSubmittable(form: AutomationFormState): boolean {
  if (!form.name.trim() || !form.prompt.trim() || !form.projectId) return false;
  if (form.mode === "heartbeat" && !form.targetThreadId) return false;
  if (automationFastIntervalLimitMessage(form)) return false;
  if (
    form.scheduleKind === "custom" &&
    (!form.intervalAmount.trim() || Number.parseInt(form.intervalAmount, 10) <= 0)
  ) {
    return false;
  }
  if (form.scheduleKind === "cron" && !form.cronExpression.trim()) return false;
  if (form.scheduleKind === "once" && !form.onceRunAt.trim()) return false;
  if (
    (form.scheduleKind === "daily" ||
      form.scheduleKind === "weekdays" ||
      form.scheduleKind === "cron" ||
      form.scheduleKind === "weekly") &&
    !form.timezone.trim()
  ) {
    return false;
  }
  if (
    (form.scheduleKind === "daily" ||
      form.scheduleKind === "weekdays" ||
      form.scheduleKind === "weekly") &&
    !TIME_OF_DAY_PATTERN.test(form.timeOfDay)
  ) {
    return false;
  }
  return true;
}
