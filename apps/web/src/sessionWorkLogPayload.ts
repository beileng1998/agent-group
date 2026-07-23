// FILE: sessionWorkLogPayload.ts
// Purpose: Decode tool identity, request kind, and changed-file metadata from provider payloads.
// Layer: Web session work-log read model

import { isToolLifecycleItemType } from "@agent-group/contracts";
import { decodeGitQuotedPath } from "@agent-group/shared/gitQuotedPath";
import { requestKindFromRequestType } from "./sessionPendingState";
import type { WorkLogEntry } from "./sessionTypes";
import { asRecord, asTrimmedString } from "./sessionValue";

export function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  const topLevel = payload?.itemType;
  if (typeof topLevel === "string" && isToolLifecycleItemType(topLevel)) return topLevel;
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const nested = data?.itemType ?? item?.type ?? item?.kind ?? payload?.type ?? payload?.kind;
  return typeof nested === "string" && isToolLifecycleItemType(nested) ? nested : undefined;
}

export function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const candidate = asTrimmedString(value);
  const normalized = candidate ? decodeGitQuotedPath(candidate) : null;
  if (!normalized || !isLikelyFilePath(normalized) || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function isLikelyFilePath(value: string): boolean {
  if (/^(?:file|vscode|cursor):\/\//iu.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  if (/^[A-Za-z]:[\\/]/u.test(value)) return true;
  if (value.includes("/") || value.includes("\\")) return true;
  return /^[^\s/\\]+\.[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) return;
    }
    return;
  }

  const record = asRecord(value);
  if (!record) return;
  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.file);
  pushChangedFile(target, seen, record.file_path);
  pushChangedFile(target, seen, record.filepath);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "rawInput",
    "rawOutput",
    "data",
    "location",
    "locations",
    "changes",
    "files",
    "file",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) continue;
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) return;
  }
}

export function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  collectChangedFiles(asRecord(payload?.data), changedFiles, new Set<string>(), 0);
  return changedFiles;
}
