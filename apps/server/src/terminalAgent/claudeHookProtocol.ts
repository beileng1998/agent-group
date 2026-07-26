import type { TerminalAgentBridgeRequest } from "./terminalAgentProtocol";
import {
  optionalBoundedHookString,
  TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
} from "./terminalAgentHookProtocolBounds";

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

export interface ClaudeHookBridgeRequest extends Omit<
  TerminalAgentBridgeRequest,
  "input" | "mode"
> {
  readonly input: unknown;
  readonly mode?: "status-line";
}

export interface ClaudeHookBridgeResponse {
  readonly additionalContext?: string;
  readonly block?: { readonly message: string };
  readonly statusLine?: string;
}

function providerString(value: unknown, field: string): string | undefined {
  return optionalBoundedHookString(value, `Claude hook ${field}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseClaudeHookBridgeRequest(value: unknown): ClaudeHookBridgeRequest {
  const request = record(value);
  const runtimeInstanceId = optionalBoundedHookString(
    request?.runtimeInstanceId,
    "Claude hook runtime instance id",
    TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
  );
  if (!request || !runtimeInstanceId || !record(request.input)) {
    throw new Error("Invalid Claude hook bridge request.");
  }
  if (request.mode !== undefined && request.mode !== "status-line") {
    throw new Error("Unsupported Claude hook bridge mode.");
  }
  const eventId = optionalBoundedHookString(
    request.eventId,
    "Claude hook event id",
    TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
  );
  return {
    runtimeInstanceId,
    input: request.input,
    ...(eventId ? { eventId } : {}),
    ...(request.mode === "status-line" ? { mode: "status-line" as const } : {}),
  };
}

export function parseClaudeHookInput(
  value: unknown,
  mode?: ClaudeHookBridgeRequest["mode"],
): ClaudeHookInput {
  const input = record(value);
  if (!input) throw new Error("Invalid Claude hook input.");
  const eventName =
    mode === "status-line"
      ? "StatusLine"
      : optionalBoundedHookString(input.hook_event_name, "Claude hook event", 64);
  if (!CLAUDE_HOOK_EVENT_NAMES.includes(eventName as ClaudeHookEventName)) {
    throw new Error("Unsupported Claude hook event.");
  }
  const effort = record(input.effort);
  const sessionId = providerString(input.session_id, "session id");
  const source = providerString(input.source, "source");
  const model = providerString(input.model, "model");
  const permissionMode = providerString(input.permission_mode, "permission mode");
  const agentId = providerString(input.agent_id, "agent id");
  const agentType = providerString(input.agent_type, "agent type");
  const error = providerString(input.error, "error");
  const errorDetails = providerString(input.error_details, "error details");
  const reason = providerString(input.reason, "reason");
  const effortLevel = providerString(effort?.level, "effort");
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
    ...(Array.isArray(input.background_tasks) ? { background_tasks: input.background_tasks } : {}),
    ...(Array.isArray(input.session_crons) ? { session_crons: input.session_crons } : {}),
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
  const modelId = providerString(model?.id, "status model");
  const effortLevel = providerString(record(input.raw.effort)?.level, "status effort");
  const permissionMode = providerString(input.raw.permission_mode, "status permission mode");
  return {
    ...(modelId ? { model: modelId } : {}),
    ...(effortLevel ? { effort: effortLevel } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  };
}
