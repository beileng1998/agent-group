// FILE: sessionWorkLogCollapse.ts
// Purpose: Collapse streaming work-log lifecycle rows without losing terminal metadata.
// Layer: Web session work-log read model

import type { OrchestrationThreadActivity } from "@agent-group/contracts";
import { isGenericToolTitle, normalizeCompactToolLabel } from "./lib/toolCallLabel";
import { mergeWorkLogToolDetails } from "./lib/toolCallDetails";
import { CONTEXT_COMPACTION_PROGRESS_LABEL } from "./sessionActivityOrder";
import { extractDetailCollapseHint } from "./sessionCommandWorkLog";
import type { DerivedWorkLogEntry } from "./sessionTypes";

export function normalizeWorkLogTextForComparison(value: string | undefined): string {
  return normalizeCompactToolLabel(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  // Stable tool-call ids merge even when parallel started/completed events are not adjacent.
  const stableToolIndexByKey = new Map<string, number>();
  for (const entry of entries) {
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseRuntimeWarningEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeRuntimeWarningEntries(previous, entry);
      continue;
    }
    if (previous && shouldCollapseContextCompactionEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      continue;
    }
    const stableToolKey =
      entry.collapseKey?.startsWith("tool:") &&
      isRenderableToolLifecycleActivity(entry.activityKind)
        ? entry.collapseKey
        : undefined;
    if (stableToolKey !== undefined) {
      const existingIndex = stableToolIndexByKey.get(stableToolKey);
      if (existingIndex !== undefined) {
        collapsed[existingIndex] = mergeDerivedWorkLogEntries(collapsed[existingIndex]!, entry);
        continue;
      }
    }
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      if (stableToolKey !== undefined)
        stableToolIndexByKey.set(stableToolKey, collapsed.length - 1);
      continue;
    }
    collapsed.push(entry);
    if (stableToolKey !== undefined) stableToolIndexByKey.set(stableToolKey, collapsed.length - 1);
  }
  return collapsed;
}

function shouldCollapseRuntimeWarningEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (previous.activityKind !== "runtime.warning" || next.activityKind !== "runtime.warning") {
    return false;
  }
  if (previous.turnId !== next.turnId) return false;
  return (
    normalizeWorkLogTextForComparison(previous.label) ===
      normalizeWorkLogTextForComparison(next.label) &&
    normalizeWorkLogTextForComparison(
      previous.runtimeWarningMessage ?? previous.detail ?? previous.preview ?? "",
    ) ===
      normalizeWorkLogTextForComparison(
        next.runtimeWarningMessage ?? next.detail ?? next.preview ?? "",
      )
  );
}

function mergeRuntimeWarningEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const repeatCount = (previous.runtimeWarningRepeatCount ?? 1) + 1;
  const runtimeWarningMessage =
    next.runtimeWarningMessage ??
    previous.runtimeWarningMessage ??
    next.detail ??
    next.preview ??
    previous.detail ??
    previous.preview;
  const repeatPreview = runtimeWarningMessage
    ? `${repeatCount} notices - ${runtimeWarningMessage}`
    : `${repeatCount} notices`;
  return {
    ...previous,
    ...next,
    runtimeWarningRepeatCount: repeatCount,
    ...(runtimeWarningMessage ? { runtimeWarningMessage } : {}),
    detail: repeatPreview,
    preview: repeatPreview,
  };
}

function shouldCollapseContextCompactionEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (
    previous.activityKind !== "context-compaction" ||
    next.activityKind !== "context-compaction"
  ) {
    return false;
  }
  if (previous.turnId !== next.turnId) return false;
  return previous.label === CONTEXT_COMPACTION_PROGRESS_LABEL;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (!isRenderableToolLifecycleActivity(previous.activityKind)) return false;
  if (!isRenderableToolLifecycleActivity(next.activityKind)) return false;
  if (previous.activityKind === "tool.completed") return false;
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    if (previous.collapseKey.startsWith("tool:")) return true;
    if (!areToolLifecycleChangedFilesCompatible(previous.changedFiles, next.changedFiles)) {
      return false;
    }
    return areToolLifecycleCommandsCompatible(previous.collapseCommand, next.collapseCommand);
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label) &&
    areToolLifecycleChangedFilesCompatible(previous.changedFiles, next.changedFiles) &&
    areToolLifecycleCommandsCompatible(previous.collapseCommand, next.collapseCommand)
  );
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const preview = next.preview ?? previous.preview;
  const toolTitle = mergeWorkLogToolTitle(previous, next);
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const subagents = next.subagents ?? previous.subagents;
  const subagentAction = next.subagentAction ?? previous.subagentAction;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolName = next.toolName ?? previous.toolName;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const toolDetails = mergeWorkLogToolDetails(previous.toolDetails, next.toolDetails);
  const turnId = next.turnId ?? previous.turnId;
  return {
    ...previous,
    ...next,
    ...(turnId !== undefined ? { turnId } : {}),
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(preview ? { preview } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(subagents ? { subagents } : {}),
    ...(subagentAction ? { subagentAction } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolDetails ? { toolDetails } : {}),
  };
}

function mergeWorkLogToolTitle(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): string | undefined {
  const previousTitle = previous.toolTitle;
  const nextTitle = next.toolTitle;
  if (!previousTitle || !nextTitle) return nextTitle ?? previousTitle;
  const isAgentTask =
    previous.itemType === "collab_agent_tool_call" || next.itemType === "collab_agent_tool_call";
  if (isAgentTask && !isGenericToolTitle(previousTitle) && isGenericToolTitle(nextTitle)) {
    return previousTitle;
  }
  return nextTitle;
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  return merged.length === 0 ? [] : [...new Set(merged)];
}

export function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (!isRenderableToolLifecycleActivity(entry.activityKind)) return undefined;
  if (entry.toolCallId) return `tool:${entry.toolCallId}`;
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const itemType = entry.itemType ?? "";
  const requestKind = entry.requestKind ?? "";
  const toolName = entry.toolName ?? "";
  const command = normalizeCompactToolLabel(entry.command ?? "");
  const detailHint = normalizeCompactToolLabel(extractDetailCollapseHint(entry.detail));
  if (
    normalizedLabel.length === 0 &&
    itemType.length === 0 &&
    requestKind.length === 0 &&
    toolName.length === 0 &&
    detailHint.length === 0
  ) {
    return command.length > 0 ? `command-only${"\u001f"}${command}` : undefined;
  }
  return [itemType, normalizedLabel, requestKind, toolName, detailHint].join("\u001f");
}

function isRenderableToolLifecycleActivity(
  kind: OrchestrationThreadActivity["kind"],
): kind is "tool.started" | "tool.updated" | "tool.completed" {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

export function deriveToolLifecycleCollapseCommand(entry: DerivedWorkLogEntry): string | undefined {
  const command = normalizeCompactToolLabel(entry.command ?? "");
  return command.length > 0 ? command : undefined;
}

function areToolLifecycleCommandsCompatible(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  if (!previous || !next) return true;
  return previous === next || previous.startsWith(next) || next.startsWith(previous);
}

function areToolLifecycleChangedFilesCompatible(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): boolean {
  if (!previous?.length || !next?.length) return true;
  return previous.some((path) => next.includes(path));
}
