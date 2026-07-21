// FILE: sessionCommandWorkLog.ts
// Purpose: Decode command actions and derive readable command work-log presentation.
// Layer: Web session work-log read model

import type { OrchestrationThreadActivity } from "@agent-group/contracts";
import { normalizeCompactToolLabel } from "./lib/toolCallLabel";
import { asRecord, asTrimmedString } from "./sessionValue";
import { extractWorkLogItemType, extractWorkLogRequestKind } from "./sessionWorkLogPayload";

export interface CommandAction {
  type: string;
  command?: string;
  name?: string;
  path?: string;
  query?: string;
}

export interface CommandActionDisplay {
  title: string;
  preview?: string;
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function asCommandArgumentRecord(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (direct) return direct;
  const text = asTrimmedString(value);
  if (!text || !text.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function isCommandLikeDetail(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false;
  if (extractWorkLogItemType(payload) === "command_execution") return true;
  if (extractWorkLogRequestKind(payload) === "command") return true;
  const normalizedTitle = normalizeCompactToolLabel(asTrimmedString(payload.title) ?? "");
  return normalizedTitle === "Ran command" || normalizedTitle === "Command run";
}

function makeCommandActionDisplay(
  title: string,
  preview: string | undefined,
): CommandActionDisplay {
  return preview === undefined ? { title } : { title, preview };
}

export function extractToolCommand(
  payload: Record<string, unknown> | null,
  commandAction: CommandAction | null = extractPrimaryCommandAction(payload),
): { command: string | null; rawCommand: string | null } {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemArguments = asCommandArgumentRecord(item?.arguments ?? item?.args ?? item?.params);
  const itemCall = asRecord(item?.call);
  const itemFunction = asRecord(item?.function);
  const dataInput = asRecord(data?.input);
  const dataArguments = asCommandArgumentRecord(data?.arguments ?? data?.args ?? data?.params);
  const rawInput = asCommandArgumentRecord(data?.rawInput);
  const detailCommand =
    isCommandLikeDetail(payload) && typeof payload?.detail === "string"
      ? stripTrailingExitCode(payload.detail).output
      : null;
  const rawCommandCandidates = [
    item?.command,
    item?.cmd,
    itemInput?.command,
    itemInput?.cmd,
    itemArguments?.command,
    itemArguments?.cmd,
    itemCall?.command,
    itemCall?.cmd,
    itemFunction?.arguments,
    itemResult?.command,
    itemResult?.cmd,
    data?.command,
    data?.cmd,
    dataInput?.command,
    dataInput?.cmd,
    dataArguments?.command,
    dataArguments?.cmd,
    rawInput?.command,
    rawInput?.cmd,
    item?.text,
    item?.summary,
    detailCommand,
  ];
  const rawCommand =
    rawCommandCandidates
      .map((candidate) => normalizeCommandValue(candidate))
      .find((candidate) => candidate !== null) ?? null;
  const command =
    normalizeCommandValue(commandAction?.command) ??
    rawCommandCandidates
      .map((candidate) => normalizeCommandValue(candidate))
      .find((candidate) => candidate !== null) ??
    null;
  return { command, rawCommand: rawCommand && rawCommand !== command ? rawCommand : null };
}

export function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

export function extractPrimaryCommandAction(
  payload: Record<string, unknown> | null,
): CommandAction | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const actions = collectCommandActions(payload, data, item);
  for (const action of actions) {
    const actionRecord = asRecord(action);
    if (!actionRecord) continue;
    const type = asTrimmedString(actionRecord.type) ?? "unknown";
    const command = asTrimmedString(actionRecord.command) ?? undefined;
    const name = asTrimmedString(actionRecord.name) ?? undefined;
    const path = asTrimmedString(actionRecord.path) ?? undefined;
    const query = asTrimmedString(actionRecord.query) ?? undefined;
    if (command || name || path || query || type !== "unknown") {
      return {
        type,
        ...(command ? { command } : {}),
        ...(name ? { name } : {}),
        ...(path ? { path } : {}),
        ...(query ? { query } : {}),
      };
    }
  }
  return null;
}

function collectCommandActions(
  payload: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  item: Record<string, unknown> | null,
): ReadonlyArray<unknown> {
  const candidates = [
    item?.commandActions,
    asCommandArgumentRecord(item?.arguments ?? item?.args ?? item?.params)?.commandActions,
    data?.commandActions,
    asCommandArgumentRecord(data?.arguments ?? data?.args ?? data?.params)?.commandActions,
    asCommandArgumentRecord(data?.rawInput)?.commandActions,
    asCommandArgumentRecord(data?.input)?.commandActions,
    payload?.commandActions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function deriveCommandActionDisplay(
  action: CommandAction | null,
  activityKind: OrchestrationThreadActivity["kind"],
): CommandActionDisplay | null {
  if (!action) return null;
  const running = activityKind !== "tool.completed";
  switch (normalizeCommandActionType(action.type)) {
    case "read":
    case "readfile":
      return makeCommandActionDisplay(running ? "Reading" : "Read", commandActionTarget(action));
    case "search":
    case "find":
      return makeCommandActionDisplay(
        running ? "Searching" : "Searched",
        commandActionSearchPreview(action),
      );
    case "listfiles":
      return makeCommandActionDisplay(
        running ? "Listing" : "Listed",
        commandActionListPreview(action),
      );
    default:
      return null;
  }
}

function normalizeCommandActionType(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function commandActionTarget(action: CommandAction): string | undefined {
  return action.name ?? compactWorkLogPath(action.path) ?? undefined;
}

function commandActionSearchPreview(action: CommandAction): string | undefined {
  const query = action.query ?? action.name;
  const path = compactWorkLogPath(action.path);
  if (query && path) return `for ${query} in ${path}`;
  if (query) return `for ${query}`;
  if (path) return `in ${path}`;
  return commandActionTarget(action);
}

function commandActionListPreview(action: CommandAction): string | undefined {
  return compactWorkLogPath(action.path) ?? action.name ?? undefined;
}

function compactWorkLogPath(value: string | undefined): string | null {
  if (!value) return null;
  if (value === ".") return "current directory";
  if (value === "..") return "parent directory";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? value : parts.slice(-2).join("/");
}

export function extractToolName(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const candidates = [data?.toolName, data?.tool, item?.toolName, item?.name, itemInput?.toolName];
  for (const candidate of candidates) {
    const normalized = asTrimmedString(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return asTrimmedString(data?.toolCallId ?? data?.callID ?? data?.callId ?? item?.id);
}

export function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) return { output: trimmed.length > 0 ? trimmed : null };
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

export function extractDetailCollapseHint(detail: string | undefined): string {
  if (!detail) return "";
  const firstLine = detail.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) return "";
  const colonIndex = firstLine.indexOf(":");
  return colonIndex <= 0 ? firstLine : firstLine.slice(0, colonIndex);
}
