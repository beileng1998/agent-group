// FILE: sessionWorkLogProjection.ts
// Purpose: Project ordered provider activity into stable, presentation-ready work-log rows.
// Layer: Web session work-log read model

import {
  STUDIO_OUTPUTS_ACTIVITY_KIND,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@agent-group/contracts";
import { summarizeToolRawOutput } from "@agent-group/shared/toolOutputSummary";
import { deriveReadableToolTitle } from "./lib/toolCallLabel";
import { deriveWorkLogToolDetails } from "./lib/toolCallDetails";
import { orderedActivities } from "./sessionActivityOrder";
import {
  deriveCommandActionDisplay,
  extractPrimaryCommandAction,
  extractToolCallId,
  extractToolCommand,
  extractToolName,
  extractToolTitle,
  stripTrailingExitCode,
} from "./sessionCommandWorkLog";
import {
  extractCollabAction,
  extractCollabActionTitle,
  extractCollabSubagents,
  extractCollabTaskOutputDetail,
} from "./sessionSubagentWorkLog";
import type { DerivedWorkLogEntry, WorkLogAutomation, WorkLogEntry } from "./sessionTypes";
import { asRecord, asTrimmedString } from "./sessionValue";
import {
  extractChangedFiles,
  extractWorkLogItemType,
  extractWorkLogRequestKind,
} from "./sessionWorkLogPayload";
import {
  collapseDerivedWorkLogEntries,
  deriveToolLifecycleCollapseCommand,
  deriveToolLifecycleCollapseKey,
  normalizeWorkLogTextForComparison,
} from "./sessionWorkLogCollapse";

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  options: { visibleTurnIds?: ReadonlySet<TurnId | string> } = {},
): WorkLogEntry[] {
  const visibleTurnIds = options.visibleTurnIds;
  const entries = orderedActivities(activities)
    .filter((activity) => shouldKeepActivityForWorkLog(activity, latestTurnId, visibleTurnIds))
    .filter((activity) => !shouldOmitRoutedCollabAgentToolActivity(activity))
    .filter((activity) => activity.kind !== "task.started" && activity.kind !== "task.completed")
    .filter((activity) => !isQuietTurnLifecycleActivity(activity))
    .filter((activity) => activity.kind !== "account.rate-limits.updated")
    .filter(
      (activity) =>
        activity.kind !== "context-window.updated" && activity.kind !== "context-window.configured",
    )
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => activity.kind !== STUDIO_OUTPUTS_ACTIVITY_KIND)
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .filter((activity) => !isUninformativeCommandStartActivity(activity))
    .map(toDerivedWorkLogEntry);
  return collapseDerivedWorkLogEntries(entries).map(
    ({
      collapseCommand: _collapseCommand,
      collapseKey: _collapseKey,
      runtimeWarningMessage: _runtimeWarningMessage,
      runtimeWarningRepeatCount: _runtimeWarningRepeatCount,
      ...entry
    }) => entry,
  );
}

function shouldKeepActivityForWorkLog(
  activity: OrchestrationThreadActivity,
  latestTurnId: TurnId | undefined,
  visibleTurnIds: ReadonlySet<TurnId | string> | undefined,
): boolean {
  if (activity.kind === "context-compaction" && activity.turnId === null) return true;
  if (activity.kind === "automation.created") return true;
  if (visibleTurnIds && visibleTurnIds.size > 0) {
    return activity.turnId !== null && visibleTurnIds.has(activity.turnId);
  }
  return latestTurnId ? activity.turnId === latestTurnId : true;
}

function shouldOmitRoutedCollabAgentToolActivity(activity: OrchestrationThreadActivity): boolean {
  const payload = asRecord(activity.payload);
  if (asTrimmedString(payload?.itemType) !== "collab_agent_tool_call") return false;
  return extractCollabSubagents(payload).length > 0;
}

function isQuietTurnLifecycleActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "turn.completed" && activity.kind !== "turn.aborted") return false;
  return activity.tone !== "error";
}

function isUninformativeCommandStartActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.started") return false;
  const payload = asRecord(activity.payload);
  if (extractWorkLogItemType(payload) !== "command_execution") return false;
  const commandAction = extractPrimaryCommandAction(payload);
  const commandPreview = extractToolCommand(payload, commandAction);
  return !commandAction && !commandPreview.command;
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") return false;
  const payload = asRecord(activity.payload);
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function extractWorkLogAutomation(
  payload: Record<string, unknown> | null,
): WorkLogAutomation | null {
  if (!payload) return null;
  const id = typeof payload.automationId === "string" ? payload.automationId : null;
  const name = typeof payload.automationName === "string" ? payload.automationName : null;
  if (!id || !name) return null;
  const cadenceLabel = typeof payload.cadenceLabel === "string" ? payload.cadenceLabel : "";
  return { id, name, cadenceLabel };
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload = asRecord(activity.payload);
  const commandAction = extractPrimaryCommandAction(payload);
  const commandPreview = extractToolCommand(payload, commandAction);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const toolName = extractToolName(payload);
  const toolCallId = extractToolCallId(payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    ...(activity.turnId !== null ? { turnId: activity.turnId } : {}),
    label: activity.summary,
    tone: activity.tone === "approval" ? "info" : activity.tone,
    activityKind: activity.kind,
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (typeof payload?.detail === "string" && payload.detail.length > 0) {
    const detail = stripTrailingExitCode(payload.detail).output;
    if (detail) entry.detail = detail;
  }
  const outputDetail = summarizeToolPayloadOutput(payload);
  if (!entry.detail && outputDetail) entry.detail = outputDetail;
  const collabTaskOutputDetail = extractCollabTaskOutputDetail(payload);
  if (collabTaskOutputDetail) entry.detail = collabTaskOutputDetail;
  const runtimeWarningMessage =
    activity.kind === "runtime.warning" &&
    typeof payload?.message === "string" &&
    payload.message.trim().length > 0
      ? payload.message.trim()
      : undefined;
  if (runtimeWarningMessage) {
    entry.detail = runtimeWarningMessage;
    entry.runtimeWarningMessage = runtimeWarningMessage;
  }
  if (commandPreview.command) entry.command = commandPreview.command;
  if (commandPreview.rawCommand) entry.rawCommand = commandPreview.rawCommand;
  const commandActionDisplay = deriveCommandActionDisplay(commandAction, activity.kind);
  if (commandActionDisplay?.preview) entry.preview = commandActionDisplay.preview;
  if (changedFiles.length > 0) entry.changedFiles = changedFiles;
  if (itemType) entry.itemType = itemType;
  if (requestKind) entry.requestKind = requestKind;
  const subagents = extractCollabSubagents(payload);
  if (subagents.length > 0) entry.subagents = subagents;
  const subagentAction = extractCollabAction(payload, subagents);
  if (subagentAction) entry.subagentAction = subagentAction;
  if (activity.kind === "automation.created") {
    const automation = extractWorkLogAutomation(payload);
    if (automation) entry.automation = automation;
  }
  const readableTitle =
    extractCollabActionTitle(payload) ??
    deriveReadableToolTitle({
      title: commandActionDisplay?.title ?? title,
      fallbackLabel: activity.summary,
      itemType,
      requestKind,
      command: commandPreview.command,
      payload,
      isRunning: activity.kind !== "tool.completed",
    });
  if (readableTitle) entry.toolTitle = readableTitle;
  if (
    entry.detail &&
    normalizeWorkLogTextForComparison(entry.detail) ===
      normalizeWorkLogTextForComparison(entry.toolTitle ?? entry.label)
  ) {
    delete entry.detail;
  }
  const toolDetails = deriveWorkLogToolDetails({
    payload,
    itemType,
    requestKind,
    command: entry.command,
    rawCommand: entry.rawCommand,
    detail: entry.detail,
    changedFiles: entry.changedFiles ?? changedFiles,
    label: entry.label,
    toolTitle: entry.toolTitle,
  });
  if (toolDetails) entry.toolDetails = toolDetails;
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) entry.collapseKey = collapseKey;
  const collapseCommand = deriveToolLifecycleCollapseCommand(entry);
  if (collapseCommand) entry.collapseCommand = collapseCommand;
  return entry;
}

function summarizeToolPayloadOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  return summarizeToolRawOutput(data?.rawOutput) ?? null;
}
