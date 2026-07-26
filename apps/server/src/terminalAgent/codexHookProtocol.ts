import type {
  TerminalAgentBridgeRequest,
  TerminalAgentEvent,
  TerminalAgentHookResponse,
} from "./terminalAgentProtocol";
import {
  nullableBoundedHookString,
  optionalBoundedHookString,
  requiredBoundedHookString,
  TERMINAL_HOOK_PATH_MAX_CHARS,
  TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
} from "./terminalAgentHookProtocolBounds";

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

export interface CodexHookBridgeRequest extends Omit<TerminalAgentBridgeRequest, "input" | "mode"> {
  readonly input: CodexHookInput;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerString(value: unknown, field: string): string {
  return requiredBoundedHookString(value, `Codex hook ${field}`);
}

function optionalProviderString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return providerString(value, field);
}

function pathString(value: unknown, field: string): string {
  return requiredBoundedHookString(value, `Codex hook ${field}`, TERMINAL_HOOK_PATH_MAX_CHARS);
}

function nullablePathString(value: unknown, field: string): string | null {
  return nullableBoundedHookString(value, `Codex hook ${field}`, TERMINAL_HOOK_PATH_MAX_CHARS);
}

function permissionMode(value: unknown): CodexPermissionMode {
  if (!CODEX_PERMISSION_MODES.includes(value as CodexPermissionMode)) {
    throw new Error("Invalid Codex hook permission mode.");
  }
  return value as CodexPermissionMode;
}

function baseInput(input: Record<string, unknown>): CodexHookInputBase {
  return {
    session_id: providerString(input.session_id, "session id"),
    cwd: pathString(input.cwd, "cwd"),
    transcript_path: nullablePathString(input.transcript_path, "transcript path"),
    model: providerString(input.model, "model"),
    permission_mode: permissionMode(input.permission_mode),
    raw: input,
  };
}

export function parseCodexHookInput(value: unknown): CodexHookInput {
  const input = record(value);
  if (!input) throw new Error("Invalid Codex hook input.");
  const eventName = requiredBoundedHookString(input.hook_event_name, "Codex hook event", 64);
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
      const agentId = optionalProviderString(input.agent_id, "agent id");
      const agentType = optionalProviderString(input.agent_type, "agent type");
      return {
        ...base,
        hook_event_name: "UserPromptSubmit",
        turn_id: providerString(input.turn_id, "turn id"),
        prompt: input.prompt,
        ...(agentId ? { agent_id: agentId } : {}),
        ...(agentType ? { agent_type: agentType } : {}),
      };
    }
    case "SubagentStart":
      return {
        ...base,
        hook_event_name: "SubagentStart",
        turn_id: providerString(input.turn_id, "turn id"),
        agent_id: providerString(input.agent_id, "agent id"),
        agent_type: providerString(input.agent_type, "agent type"),
      };
    case "Stop":
      if (typeof input.stop_hook_active !== "boolean") {
        throw new Error("Invalid Codex Stop state.");
      }
      return {
        ...base,
        hook_event_name: "Stop",
        turn_id: providerString(input.turn_id, "turn id"),
        stop_hook_active: input.stop_hook_active,
        last_assistant_message:
          input.last_assistant_message === null
            ? null
            : typeof input.last_assistant_message === "string"
              ? input.last_assistant_message
              : nullableBoundedHookString(
                  input.last_assistant_message,
                  "Codex hook assistant message",
                ),
      };
  }
}

export function parseCodexHookBridgeRequest(value: unknown): CodexHookBridgeRequest {
  const request = record(value);
  if (!request) throw new Error("Invalid Codex hook bridge request.");
  if (request.mode !== undefined) {
    throw new Error("Codex hooks do not support a bridge mode.");
  }
  const eventId = optionalBoundedHookString(
    request.eventId,
    "Codex hook event id",
    TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
  );
  return {
    runtimeInstanceId: requiredBoundedHookString(
      request.runtimeInstanceId,
      "Codex hook runtime instance id",
      TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
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
        providerResumeCursor: { threadId: input.session_id },
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
