import type {
  TerminalAgentBridgeRequest,
  TerminalAgentEvent,
  TerminalAgentHookResponse,
} from "./terminalAgentProtocol";

export const CODEX_HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
  "Stop",
] as const;

export type CodexHookEventName = (typeof CODEX_HOOK_EVENT_NAMES)[number];

const CODEX_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions",
] as const;

export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number];

interface CodexHookInputBase {
  readonly session_id: string;
  readonly cwd: string;
  readonly transcript_path: string | null;
  readonly model: string;
  readonly permission_mode: CodexPermissionMode;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CodexSessionStartHookInput extends CodexHookInputBase {
  readonly hook_event_name: "SessionStart";
  readonly source: "startup" | "resume" | "clear" | "compact";
}

export interface CodexUserPromptSubmitHookInput extends CodexHookInputBase {
  readonly hook_event_name: "UserPromptSubmit";
  readonly turn_id: string;
  readonly prompt: string;
  readonly agent_id?: string;
  readonly agent_type?: string;
}

export interface CodexSubagentStartHookInput extends CodexHookInputBase {
  readonly hook_event_name: "SubagentStart";
  readonly turn_id: string;
  readonly agent_id: string;
  readonly agent_type: string;
}

export interface CodexStopHookInput extends CodexHookInputBase {
  readonly hook_event_name: "Stop";
  readonly turn_id: string;
  readonly stop_hook_active: boolean;
  readonly last_assistant_message: string | null;
}

export type CodexHookInput =
  | CodexSessionStartHookInput
  | CodexUserPromptSubmitHookInput
  | CodexSubagentStartHookInput
  | CodexStopHookInput;

export interface CodexHookBridgeRequest
  extends Omit<TerminalAgentBridgeRequest, "input" | "mode"> {
  readonly input: CodexHookInput;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid Codex hook ${field}.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, field);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return nonEmptyString(value, field);
}

function permissionMode(value: unknown): CodexPermissionMode {
  if (!CODEX_PERMISSION_MODES.includes(value as CodexPermissionMode)) {
    throw new Error("Invalid Codex hook permission mode.");
  }
  return value as CodexPermissionMode;
}

function baseInput(input: Record<string, unknown>): CodexHookInputBase {
  return {
    session_id: nonEmptyString(input.session_id, "session id"),
    cwd: nonEmptyString(input.cwd, "cwd"),
    transcript_path: nullableString(input.transcript_path, "transcript path"),
    model: nonEmptyString(input.model, "model"),
    permission_mode: permissionMode(input.permission_mode),
    raw: input,
  };
}

export function parseCodexHookInput(value: unknown): CodexHookInput {
  const input = record(value);
  if (!input) throw new Error("Invalid Codex hook input.");
  const eventName = nonEmptyString(input.hook_event_name, "event");
  if (!CODEX_HOOK_EVENT_NAMES.includes(eventName as CodexHookEventName)) {
    throw new Error("Unsupported Codex hook event.");
  }
  const base = baseInput(input);
  switch (eventName as CodexHookEventName) {
    case "SessionStart": {
      const source = input.source;
      if (!["startup", "resume", "clear", "compact"].includes(String(source))) {
        throw new Error("Invalid Codex SessionStart source.");
      }
      return {
        ...base,
        hook_event_name: "SessionStart",
        source: source as CodexSessionStartHookInput["source"],
      };
    }
    case "UserPromptSubmit": {
      if (typeof input.prompt !== "string") {
        throw new Error("Invalid Codex hook prompt.");
      }
      const agentId = optionalString(input.agent_id, "agent id");
      const agentType = optionalString(input.agent_type, "agent type");
      return {
        ...base,
        hook_event_name: "UserPromptSubmit",
        turn_id: nonEmptyString(input.turn_id, "turn id"),
        prompt: input.prompt,
        ...(agentId ? { agent_id: agentId } : {}),
        ...(agentType ? { agent_type: agentType } : {}),
      };
    }
    case "SubagentStart":
      return {
        ...base,
        hook_event_name: "SubagentStart",
        turn_id: nonEmptyString(input.turn_id, "turn id"),
        agent_id: nonEmptyString(input.agent_id, "agent id"),
        agent_type: nonEmptyString(input.agent_type, "agent type"),
      };
    case "Stop":
      if (typeof input.stop_hook_active !== "boolean") {
        throw new Error("Invalid Codex Stop state.");
      }
      return {
        ...base,
        hook_event_name: "Stop",
        turn_id: nonEmptyString(input.turn_id, "turn id"),
        stop_hook_active: input.stop_hook_active,
        last_assistant_message: nullableString(
          input.last_assistant_message,
          "assistant message",
        ),
      };
  }
}

export function parseCodexHookBridgeRequest(
  value: unknown,
): CodexHookBridgeRequest {
  const request = record(value);
  if (!request) throw new Error("Invalid Codex hook bridge request.");
  if (request.mode !== undefined) {
    throw new Error("Codex hooks do not support a bridge mode.");
  }
  const eventId = optionalString(request.eventId, "event id");
  return {
    runtimeInstanceId: nonEmptyString(
      request.runtimeInstanceId,
      "runtime instance id",
    ),
    input: parseCodexHookInput(request.input),
    ...(eventId ? { eventId } : {}),
  };
}

export function codexHookInputToTerminalEvent(
  input: CodexHookInput,
  eventId?: string,
): TerminalAgentEvent {
  const event = eventId ? { eventId } : {};
  switch (input.hook_event_name) {
    case "SessionStart":
      return {
        ...event,
        type: "session_start",
        providerSessionId: input.session_id,
        reason: input.source,
        model: input.model,
        permissionMode: input.permission_mode,
      };
    case "UserPromptSubmit":
      return {
        ...event,
        type: "prompt_submit",
        prompt: input.prompt,
        providerTurnId: input.turn_id,
        model: input.model,
        permissionMode: input.permission_mode,
      };
    case "SubagentStart":
      return {
        ...event,
        type: "subagent_start",
        providerTurnId: input.turn_id,
        agentId: input.agent_id,
      };
    case "Stop":
      return {
        ...event,
        type: "turn_stop",
        providerTurnId: input.turn_id,
        ...(input.last_assistant_message !== null
          ? { assistantText: input.last_assistant_message }
          : {}),
      };
  }
}

export function encodeCodexHookResponse(
  eventName: CodexHookEventName,
  response: TerminalAgentHookResponse,
): Readonly<Record<string, unknown>> {
  if (response.block) {
    if (eventName !== "UserPromptSubmit") {
      throw new Error("Only Codex prompt submission can be blocked.");
    }
    return { decision: "block", reason: response.block.message };
  }
  if (!response.additionalContext) return {};
  if (eventName === "Stop") {
    throw new Error("Codex Stop does not accept additional context.");
  }
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: response.additionalContext,
    },
  };
}
