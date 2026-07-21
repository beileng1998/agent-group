import {
  DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS,
  DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS,
  type AutomationAllowedCapability,
  type AutomationCompletionPolicy,
  type AutomationDefinition,
  type AutomationRun,
  type AutomationUpdateInput,
} from "@agent-group/contracts";

import {
  computeAutomationScheduleSpacingSeconds,
  computeNextAutomationRunAt,
  computeNextAutomationRunAtAfter,
} from "../../schedule.ts";

const FAST_INTERVAL_ACKNOWLEDGED_MINIMUM_SECONDS = 1;
const DEFAULT_COMPLETION_POLICY = { type: "none" } as const satisfies AutomationCompletionPolicy;

export function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isSameAiCompletionPolicy(
  left: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>,
  right: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>,
): boolean {
  return left.stopWhen === right.stopWhen && left.confidenceThreshold === right.confidenceThreshold;
}

function isSameCompletionPolicy(
  left: AutomationCompletionPolicy,
  right: AutomationCompletionPolicy,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "none") return true;
  return right.type === "ai-evaluated" && isSameAiCompletionPolicy(left, right);
}

export function completionPolicyForDefinition(
  definition: AutomationDefinition,
): AutomationCompletionPolicy {
  return definition.completionPolicy ?? DEFAULT_COMPLETION_POLICY;
}

export function completionPolicyVersionForDefinition(definition: AutomationDefinition): number {
  return definition.completionPolicyVersion ?? 1;
}

function completionPolicyUpdatedAtForDefinition(definition: AutomationDefinition): string {
  return definition.completionPolicyUpdatedAt ?? definition.createdAt;
}

export function runUsesCurrentCompletionPolicy(
  run: AutomationRun,
  definition: AutomationDefinition,
): boolean {
  if (run.permissionSnapshot.completionPolicyVersion !== undefined) {
    return (
      run.permissionSnapshot.completionPolicyVersion ===
      completionPolicyVersionForDefinition(definition)
    );
  }
  const runPolicyAnchorMs = Date.parse(run.startedAt ?? run.createdAt);
  const policyUpdatedAtMs = Date.parse(completionPolicyUpdatedAtForDefinition(definition));
  return (
    Number.isFinite(runPolicyAnchorMs) &&
    Number.isFinite(policyUpdatedAtMs) &&
    runPolicyAnchorMs > policyUpdatedAtMs
  );
}

function allowedCapabilitiesFor(definition: AutomationDefinition): AutomationAllowedCapability[] {
  const capabilities: AutomationAllowedCapability[] = ["send-turn"];
  if (definition.worktreeMode !== "local") capabilities.push("create-worktree");
  if (definition.runtimeMode === "full-access") capabilities.push("full-access");
  return capabilities;
}

export function makePermissionSnapshot(definition: AutomationDefinition, now: string) {
  return {
    provider: definition.modelSelection.provider,
    modelSelection: definition.modelSelection,
    ...(definition.providerOptions ? { providerOptions: definition.providerOptions } : {}),
    completionPolicyVersion: completionPolicyVersionForDefinition(definition),
    runtimeMode: definition.runtimeMode,
    interactionMode: definition.interactionMode,
    worktreeMode: definition.worktreeMode,
    allowedCapabilities: allowedCapabilitiesFor(definition),
    createdAt: now,
  };
}

export function safeComputeNextRunAt(
  schedule: AutomationDefinition["schedule"],
  now: string,
  fallback: string | null,
) {
  try {
    return computeNextAutomationRunAt(schedule, now);
  } catch {
    return fallback;
  }
}

export function effectiveMinimumIntervalSeconds(input: {
  readonly minimumIntervalSeconds: number;
  readonly acknowledgedRisks: readonly string[];
}): number {
  if (
    input.acknowledgedRisks.includes("fast-interval") &&
    input.minimumIntervalSeconds === DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS
  )
    return FAST_INTERVAL_ACKNOWLEDGED_MINIMUM_SECONDS;
  return input.minimumIntervalSeconds;
}

export function riskAcknowledgementError(input: {
  readonly runtimeMode: AutomationDefinition["runtimeMode"];
  readonly worktreeMode: AutomationDefinition["worktreeMode"];
  readonly acknowledgedRisks: readonly string[];
}): string | null {
  const acknowledgedRisks = new Set(input.acknowledgedRisks);
  if (input.runtimeMode === "full-access" && !acknowledgedRisks.has("full-access")) {
    return "Automation full-access mode requires an explicit acknowledgement.";
  }
  if (input.worktreeMode === "local" && !acknowledgedRisks.has("local-checkout")) {
    return "Automation local checkout mode requires an explicit acknowledgement.";
  }
  return null;
}

export function fastIntervalPolicyError(input: {
  readonly schedule: AutomationDefinition["schedule"];
  readonly enabled: boolean;
  readonly maxIterations: AutomationDefinition["maxIterations"];
  readonly acknowledgedRisks: readonly string[];
  readonly now: string;
}): string | null {
  const spacingSeconds = computeAutomationScheduleSpacingSeconds(input.schedule, input.now);
  if (spacingSeconds === null || spacingSeconds >= DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS)
    return null;
  if (!input.acknowledgedRisks.includes("fast-interval")) {
    return `Automation schedule must run at least ${DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS} seconds apart.`;
  }
  const exceedsFastIterationCap =
    input.maxIterations === null ||
    input.maxIterations > DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS;
  if (input.enabled && exceedsFastIterationCap) {
    return `Fast interval automations must set max iterations to ${DEFAULT_AUTOMATION_FAST_INTERVAL_MAX_ITERATIONS} runs or fewer.`;
  }
  return null;
}

export function hasExceededMaxRuntime(
  definition: AutomationDefinition,
  run: AutomationRun,
  now: string,
): boolean {
  if (definition.maxRuntimeSeconds === null || run.startedAt === null) return false;
  const startedAtMs = Date.parse(run.startedAt);
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(startedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - startedAtMs >= definition.maxRuntimeSeconds * 1000
  );
}

export function runUsesExistingThread(run: AutomationRun): boolean {
  return run.threadCreateCommandId === null;
}

export function scheduledOccurrenceForDefinition(definition: AutomationDefinition, now: string) {
  const plannedScheduledFor = definition.nextRunAt ?? now;
  const valueMs = Date.parse(plannedScheduledFor);
  const comparisonMs = Date.parse(now);
  const missed =
    Number.isFinite(valueMs) && Number.isFinite(comparisonMs) && valueMs < comparisonMs;
  const scheduledFor =
    missed && definition.misfirePolicy === "run-latest" ? now : plannedScheduledFor;
  const nextRunAt = computeNextAutomationRunAtAfter(definition.schedule, scheduledFor, now);
  return { scheduledFor, nextRunAt, skip: missed && definition.misfirePolicy === "skip" };
}

export function mergeDefinitionUpdate(
  current: AutomationDefinition,
  input: AutomationUpdateInput,
  now: string,
): AutomationDefinition {
  const schedule = input.schedule ?? current.schedule;
  const nextRunAt =
    schedule.type === "manual"
      ? null
      : input.schedule
        ? safeComputeNextRunAt(schedule, now, current.nextRunAt)
        : (current.nextRunAt ?? safeComputeNextRunAt(schedule, now, null));
  const providerOptions = input.providerOptions ?? current.providerOptions;
  const mode = input.mode ?? current.mode;
  const currentCompletionPolicy = completionPolicyForDefinition(current);
  const completionPolicy =
    mode === "standalone"
      ? { type: "none" as const }
      : (input.completionPolicy ?? currentCompletionPolicy);
  const completionPolicyChanged = !isSameCompletionPolicy(
    currentCompletionPolicy,
    completionPolicy,
  );
  const maxIterations = hasOwn(input, "maxIterations")
    ? ((input.maxIterations as AutomationDefinition["maxIterations"] | undefined) ?? null)
    : current.maxIterations;
  const nextDefinition: AutomationDefinition = {
    ...current,
    projectId: input.projectId ?? current.projectId,
    sourceThreadId: hasOwn(input, "sourceThreadId")
      ? ((input.sourceThreadId as AutomationDefinition["sourceThreadId"] | undefined) ?? null)
      : current.sourceThreadId,
    name: input.name ?? current.name,
    prompt: input.prompt ?? current.prompt,
    schedule,
    enabled: input.enabled ?? current.enabled,
    nextRunAt,
    modelSelection: input.modelSelection ?? current.modelSelection,
    runtimeMode: input.runtimeMode ?? current.runtimeMode,
    interactionMode: input.interactionMode ?? current.interactionMode,
    worktreeMode: input.worktreeMode ?? current.worktreeMode,
    mode,
    targetThreadId: hasOwn(input, "targetThreadId")
      ? ((input.targetThreadId as AutomationDefinition["targetThreadId"] | undefined) ?? null)
      : current.targetThreadId,
    maxIterations,
    stopOnError: input.stopOnError ?? current.stopOnError,
    completionPolicy,
    completionPolicyVersion: completionPolicyChanged
      ? completionPolicyVersionForDefinition(current) + 1
      : completionPolicyVersionForDefinition(current),
    completionPolicyUpdatedAt: completionPolicyChanged
      ? now
      : completionPolicyUpdatedAtForDefinition(current),
    minimumIntervalSeconds: input.minimumIntervalSeconds ?? current.minimumIntervalSeconds,
    maxRuntimeSeconds: hasOwn(input, "maxRuntimeSeconds")
      ? ((input.maxRuntimeSeconds as AutomationDefinition["maxRuntimeSeconds"] | undefined) ?? null)
      : current.maxRuntimeSeconds,
    retryPolicy: input.retryPolicy ?? current.retryPolicy,
    misfirePolicy: input.misfirePolicy ?? current.misfirePolicy,
    acknowledgedRisks: input.acknowledgedRisks ?? current.acknowledgedRisks,
    updatedAt: now,
  };
  return providerOptions ? { ...nextDefinition, providerOptions } : nextDefinition;
}
