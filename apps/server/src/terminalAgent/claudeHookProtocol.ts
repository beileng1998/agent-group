import type { TerminalAgentBridgeRequest } from "./terminalAgentProtocol";

export const CLAUDE_HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "StatusLine",
] as const;

export type ClaudeHookEventName = (typeof CLAUDE_HOOK_EVENT_NAMES)[number];

export interface ClaudeHookInput {
  readonly hook_event_name: ClaudeHookEventName;
  readonly session_id?: string;
  readonly prompt?: string;
  readonly source?: string;
  readonly model?: string;
  readonly permission_mode?: string;
  readonly agent_id?: string;
  readonly agent_type?: string;
  readonly last_assistant_message?: string;
  readonly error?: string;
  readonly error_details?: string;
  readonly reason?: string;
  readonly background_tasks?: ReadonlyArray<unknown>;
  readonly session_crons?: ReadonlyArray<unknown>;
  readonly effort?: { readonly level?: string };
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ClaudeHookBridgeRequest
  extends Omit<TerminalAgentBridgeRequest, "input" | "mode"> {
  readonly input: unknown;
  readonly mode?: "status-line";
}

export interface ClaudeHookBridgeResponse {
  readonly additionalContext?: string;
  readonly block?: { readonly message: string };
  readonly statusLine?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseClaudeHookBridgeRequest(
  value: unknown,
): ClaudeHookBridgeRequest {
  const request = record(value);
  const runtimeInstanceId = nonEmptyString(request?.runtimeInstanceId);
  if (!request || !runtimeInstanceId || !record(request.input)) {
    throw new Error("Invalid Claude hook bridge request.");
  }
  if (request.mode !== undefined && request.mode !== "status-line") {
    throw new Error("Unsupported Claude hook bridge mode.");
  }
  const eventId = nonEmptyString(request.eventId);
  return {
    runtimeInstanceId,
    input: request.input,
    ...(eventId ? { eventId } : {}),
    ...(request.mode === "status-line"
      ? { mode: "status-line" as const }
      : {}),
  };
}

export function parseClaudeHookInput(
  value: unknown,
  mode?: ClaudeHookBridgeRequest["mode"],
): ClaudeHookInput {
  const input = record(value);
  if (!input) throw new Error("Invalid Claude hook input.");
  const eventName =
    mode === "status-line" ? "StatusLine" : nonEmptyString(input.hook_event_name);
  if (!CLAUDE_HOOK_EVENT_NAMES.includes(eventName as ClaudeHookEventName)) {
    throw new Error("Unsupported Claude hook event.");
  }
  const effort = record(input.effort);
  const sessionId = nonEmptyString(input.session_id);
  const source = nonEmptyString(input.source);
  const model = nonEmptyString(input.model);
  const permissionMode = nonEmptyString(input.permission_mode);
  const agentId = nonEmptyString(input.agent_id);
  const agentType = nonEmptyString(input.agent_type);
  const error = nonEmptyString(input.error);
  const errorDetails = nonEmptyString(input.error_details);
  const reason = nonEmptyString(input.reason);
  const effortLevel = nonEmptyString(effort?.level);
  return {
    hook_event_name: eventName as ClaudeHookEventName,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
    ...(source ? { source } : {}),
    ...(model ? { model } : {}),
    ...(permissionMode ? { permission_mode: permissionMode } : {}),
    ...(agentId ? { agent_id: agentId } : {}),
    ...(agentType ? { agent_type: agentType } : {}),
    ...(typeof input.last_assistant_message === "string"
      ? { last_assistant_message: input.last_assistant_message }
      : {}),
    ...(error ? { error } : {}),
    ...(errorDetails ? { error_details: errorDetails } : {}),
    ...(reason ? { reason } : {}),
    ...(Array.isArray(input.background_tasks)
      ? { background_tasks: input.background_tasks }
      : {}),
    ...(Array.isArray(input.session_crons)
      ? { session_crons: input.session_crons }
      : {}),
    ...(effortLevel ? { effort: { level: effortLevel } } : {}),
    raw: input,
  };
}

export function parseClaudeStatusLine(input: ClaudeHookInput): {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
} {
  const model = record(input.raw.model);
  const modelId = nonEmptyString(model?.id);
  const effortLevel = nonEmptyString(record(input.raw.effort)?.level);
  const permissionMode = nonEmptyString(input.raw.permission_mode);
  return {
    ...(modelId ? { model: modelId } : {}),
    ...(effortLevel ? { effort: effortLevel } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  };
}
