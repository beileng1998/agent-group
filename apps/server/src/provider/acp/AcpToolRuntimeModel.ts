import type * as EffectAcpSchema from "effect-acp/schema";
import type { ToolLifecycleItemType } from "@agent-group/contracts";
import { summarizeToolRawOutput } from "@agent-group/shared/toolOutputSummary";

export interface AcpToolCallState {
  readonly toolCallId: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: "pending" | "inProgress" | "completed" | "failed";
  readonly command?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
}

export interface AcpPermissionRequest {
  readonly kind: string | "unknown";
  readonly detail?: string;
  readonly toolCall?: AcpToolCallState;
}

type AcpToolCallUpdate = Extract<
  EffectAcpSchema.SessionNotification["update"],
  { readonly sessionUpdate: "tool_call" | "tool_call_update" }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolCallStatus(
  raw: unknown,
  fallback?: "pending" | "inProgress" | "completed" | "failed",
): "pending" | "inProgress" | "completed" | "failed" | undefined {
  switch (raw) {
    case "pending":
      return "pending";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return fallback;
  }
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => (typeof entry === "string" && entry.trim().length > 0 ? entry.trim() : null))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const match = /`([^`]+)`/.exec(title);
  return match?.[1]?.trim() || undefined;
}

function extractToolCallCommand(rawInput: unknown, title: string | undefined): string | undefined {
  if (isRecord(rawInput)) {
    const directCommand = normalizeCommandValue(rawInput.command);
    if (directCommand) {
      return directCommand;
    }
    const executable = typeof rawInput.executable === "string" ? rawInput.executable.trim() : "";
    const args = normalizeCommandValue(rawInput.args);
    if (executable && args) {
      return `${executable} ${args}`;
    }
    if (executable) {
      return executable;
    }
  }
  return extractCommandFromTitle(title);
}

function extractTextContentFromToolCallContent(
  content: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined,
): string | undefined {
  if (!content) return undefined;
  const chunks = content
    .map((entry) => {
      if (entry.type !== "content") {
        return undefined;
      }
      const nestedContent = entry.content;
      if (nestedContent.type !== "text") {
        return undefined;
      }
      return nestedContent.text.trim().length > 0 ? nestedContent.text.trim() : undefined;
    })
    .filter((entry): entry is string => entry !== undefined);
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function summarizeToolCallLocations(
  locations: ReadonlyArray<EffectAcpSchema.ToolCallLocation> | null | undefined,
): string | undefined {
  const paths = (locations ?? [])
    .map((location) =>
      location.line === undefined || location.line === null
        ? location.path.trim()
        : `${location.path.trim()}:${location.line}`,
    )
    .filter((entry) => entry.length > 0);
  if (paths.length === 0) {
    return undefined;
  }
  return paths.length === 1 ? paths[0] : `${paths[0]} +${paths.length - 1} more`;
}

function summarizeToolCallContent(
  content: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined,
): string | undefined {
  for (const entry of content ?? []) {
    if (entry.type === "diff") {
      return entry.path.trim() || undefined;
    }
    if (entry.type !== "content") {
      continue;
    }
    const nested = entry.content;
    if (nested.type === "resource_link") {
      return (nested.title ?? nested.name ?? nested.uri).trim() || undefined;
    }
    if (nested.type === "resource") {
      const resource = nested.resource;
      const uri = "uri" in resource && typeof resource.uri === "string" ? resource.uri.trim() : "";
      return uri || undefined;
    }
  }
  return extractTextContentFromToolCallContent(content);
}

function isProviderGenericToolTitle(title: string | undefined, kind: string | undefined): boolean {
  const normalized = title?.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (normalized === "tool" || normalized === "terminal" || normalized === "tool call") {
    return true;
  }
  if (kind === "search" && normalized === "find") {
    return true;
  }
  if (kind === "read" && (normalized === "read" || normalized === "read file")) {
    return true;
  }
  return false;
}

function normalizeToolKind(kind: unknown): string | undefined {
  return typeof kind === "string" && kind.trim().length > 0 ? kind.trim() : undefined;
}

function inferToolKindFromProviderTitle(title: string | undefined): string | undefined {
  const normalized = title?.toLowerCase().replace(/\s+/g, " ").trim();
  switch (normalized) {
    case "find":
      return "search";
    case "read":
    case "read file":
      return "read";
    case "terminal":
      return "execute";
    default:
      return undefined;
  }
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "fetch":
      return "web_search";
    case "search":
    default:
      return "dynamic_tool_call";
  }
}

function deriveGenericToolActionTitle(
  kind: string | undefined,
  status: "pending" | "inProgress" | "completed" | "failed" | undefined,
): string | undefined {
  const running = status === "pending" || status === "inProgress" || status === undefined;
  switch (kind) {
    case "execute":
      return "Ran command";
    case "edit":
      return running ? "Editing" : "Edited";
    case "delete":
      return running ? "Deleting" : "Deleted";
    case "move":
      return running ? "Moving" : "Moved";
    case "search":
      return running ? "Searching" : "Searched";
    case "fetch":
      return running ? "Fetching" : "Fetched";
    case "read":
      return running ? "Reading" : "Read";
    default:
      return undefined;
  }
}

function deriveToolActivityPresentation(input: {
  readonly itemType: ToolLifecycleItemType;
  readonly title?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
  readonly fallbackSummary: string;
}): { readonly summary: string; readonly detail?: string } {
  const summary = input.title?.trim() || input.fallbackSummary;
  const detail = input.detail?.trim();
  return detail ? { summary, detail } : { summary };
}

function makeToolCallState(
  input: {
    readonly toolCallId: string;
    readonly title?: string | null | undefined;
    readonly kind?: EffectAcpSchema.ToolKind | null | undefined;
    readonly status?: EffectAcpSchema.ToolCallStatus | null | undefined;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined;
    readonly locations?: ReadonlyArray<EffectAcpSchema.ToolCallLocation> | null | undefined;
  },
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  const toolCallId = input.toolCallId.trim();
  if (!toolCallId) {
    return undefined;
  }
  const title = input.title?.trim() || undefined;
  const command = extractToolCallCommand(input.rawInput, title);
  const textContent = extractTextContentFromToolCallContent(input.content);
  const structuredContent = summarizeToolCallContent(input.content);
  const locationDetail = summarizeToolCallLocations(input.locations);
  const outputDetail = summarizeToolRawOutput(input.rawOutput);
  const status = normalizeToolCallStatus(input.status, options?.fallbackStatus);
  const kind = normalizeToolKind(input.kind) ?? inferToolKindFromProviderTitle(title);
  const normalizedTitle =
    title && title.toLowerCase() !== "terminal" && title.toLowerCase() !== "tool call"
      ? title
      : undefined;
  const data: Record<string, unknown> = { toolCallId };
  if (kind) data.kind = kind;
  if (command) data.command = command;
  if (input.rawInput !== undefined) data.rawInput = input.rawInput;
  if (input.rawOutput !== undefined) data.rawOutput = input.rawOutput;
  if (input.content !== undefined) data.content = input.content;
  if (input.locations !== undefined) data.locations = input.locations;
  const kindSpecificTitleIsGeneric = isProviderGenericToolTitle(title, kind);
  const fallbackDetail =
    command ??
    locationDetail ??
    structuredContent ??
    outputDetail ??
    (kindSpecificTitleIsGeneric ? undefined : normalizedTitle) ??
    textContent;
  const actionTitle = deriveGenericToolActionTitle(kind, status);
  const hasPresentationSeed =
    title !== undefined ||
    kind !== undefined ||
    command !== undefined ||
    locationDetail !== undefined ||
    structuredContent !== undefined ||
    outputDetail !== undefined ||
    normalizedTitle !== undefined ||
    textContent !== undefined;
  const itemType = canonicalItemTypeFromAcpToolKind(kind);
  const presentation = hasPresentationSeed
    ? deriveToolActivityPresentation({
        itemType,
        data,
        fallbackSummary: actionTitle ?? (itemType === "command_execution" ? "Ran command" : "Tool"),
        ...(normalizedTitle !== undefined && !kindSpecificTitleIsGeneric
          ? { title: normalizedTitle }
          : actionTitle !== undefined
            ? { title: actionTitle }
            : {}),
        ...(fallbackDetail !== undefined ? { detail: fallbackDetail } : {}),
      })
    : undefined;
  return {
    toolCallId,
    ...(kind ? { kind } : {}),
    ...(presentation?.summary ? { title: presentation.summary } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(presentation?.detail ? { detail: presentation.detail } : {}),
    data,
  };
}

export function parseAcpToolCallUpdate(
  event: AcpToolCallUpdate,
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  return makeToolCallState(
    {
      toolCallId: event.toolCallId,
      title: event.title,
      kind: event.kind,
      status: event.status,
      rawInput: event.rawInput,
      rawOutput: event.rawOutput,
      content: event.content,
      locations: event.locations,
    },
    options,
  );
}

export function mergeToolCallState(
  previous: AcpToolCallState | undefined,
  next: AcpToolCallState,
): AcpToolCallState {
  const nextKind = typeof next.data.kind === "string" ? next.data.kind : undefined;
  const kind = nextKind ?? previous?.kind;
  const status = next.status ?? previous?.status;
  const nextTitleIsGeneric = isProviderGenericToolTitle(next.title, kind);
  const actionTitle = nextTitleIsGeneric ? deriveGenericToolActionTitle(kind, status) : undefined;
  const title = nextTitleIsGeneric
    ? (actionTitle ?? previous?.title ?? next.title)
    : (next.title ?? previous?.title);
  const command = next.command ?? previous?.command;
  const detail = next.detail ?? previous?.detail;
  return {
    toolCallId: next.toolCallId,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(detail ? { detail } : {}),
    data: { ...previous?.data, ...next.data },
  };
}

export function parsePermissionRequest(
  params: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionRequest {
  const toolCall = makeToolCallState(
    {
      toolCallId: params.toolCall.toolCallId,
      title: params.toolCall.title,
      kind: params.toolCall.kind,
      status: params.toolCall.status,
      rawInput: params.toolCall.rawInput,
      rawOutput: params.toolCall.rawOutput,
      content: params.toolCall.content,
      locations: params.toolCall.locations,
    },
    { fallbackStatus: "pending" },
  );
  const kind = normalizeToolKind(params.toolCall.kind) ?? "unknown";
  const detail =
    toolCall?.command ??
    toolCall?.title ??
    toolCall?.detail ??
    (typeof params.sessionId === "string" ? `Session ${params.sessionId}` : undefined);
  return {
    kind,
    ...(detail ? { detail } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}
