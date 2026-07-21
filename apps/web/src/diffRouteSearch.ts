// FILE: diffRouteSearch.ts
// Purpose: Normalizes URL search state for chat side panels and diff-file deep links.
// Layer: Route state utility

import { MessageId, ThreadId, ThreadMarkerId, TurnId } from "@agent-group/contracts";

export type ChatRightPanel = "browser" | "diff";

export interface DiffRouteSearch {
  splitViewId?: string | undefined;
  view?: "editor" | undefined;
  editorFilePath?: string | undefined;
  panel?: ChatRightPanel | undefined;
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  highlightId?: ThreadMarkerId | undefined;
  messageThreadId?: ThreadId | undefined;
  messageId?: MessageId | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "panel" | "diff" | "diffTurnId" | "diffFilePath"> {
  const {
    panel: _panel,
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    ...rest
  } = params;
  return rest as Omit<T, "panel" | "diff" | "diffTurnId" | "diffFilePath">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const splitViewId = normalizeSearchString(search.splitViewId);
  const viewRaw = normalizeSearchString(search.view);
  const view = viewRaw === "editor" ? "editor" : undefined;
  const editorFilePath = view ? normalizeSearchString(search.editorFilePath) : undefined;
  const panelRaw = normalizeSearchString(search.panel);
  const panel: ChatRightPanel | undefined =
    panelRaw === "browser" ? "browser" : panelRaw === "diff" ? "diff" : undefined;
  const diff = panel === "diff" || isDiffOpenValue(search.diff) ? "1" : undefined;
  const resolvedPanel = panel ?? (diff ? "diff" : undefined);
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath = diff ? normalizeSearchString(search.diffFilePath) : undefined;
  const highlightIdRaw = normalizeSearchString(search.highlightId);
  const highlightId = highlightIdRaw ? ThreadMarkerId.makeUnsafe(highlightIdRaw) : undefined;
  const messageThreadIdRaw = normalizeSearchString(search.messageThreadId);
  const messageIdRaw = normalizeSearchString(search.messageId);
  const messageThreadId =
    messageThreadIdRaw && messageIdRaw ? ThreadId.makeUnsafe(messageThreadIdRaw) : undefined;
  const messageId =
    messageThreadIdRaw && messageIdRaw ? MessageId.makeUnsafe(messageIdRaw) : undefined;

  return {
    ...(splitViewId ? { splitViewId } : {}),
    ...(view ? { view } : {}),
    ...(editorFilePath ? { editorFilePath } : {}),
    ...(resolvedPanel ? { panel: resolvedPanel } : {}),
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(highlightId ? { highlightId } : {}),
    ...(messageThreadId && messageId ? { messageThreadId, messageId } : {}),
  };
}
