export const PI_TERMINAL_EVENT_NAMES = [
  "session_start",
  "prompt_submit",
  "turn_stop",
  "turn_failure",
  "runtime_state",
  "session_compact",
  "session_shutdown",
  "unmanaged_input",
] as const;

export type PiTerminalEventName = (typeof PI_TERMINAL_EVENT_NAMES)[number];

interface PiTerminalEventBase {
  readonly event_name: PiTerminalEventName;
  readonly event_id: string;
  readonly session_id?: string;
  readonly session_file?: string;
}

export interface PiTerminalSessionStartEvent extends PiTerminalEventBase {
  readonly event_name: "session_start";
  readonly session_id: string;
  readonly reason: string;
  readonly model?: string;
  readonly model_provider?: string;
  readonly thinking_level?: string;
  readonly permission_mode?: string;
}

export interface PiTerminalPromptSubmitEvent extends PiTerminalEventBase {
  readonly event_name: "prompt_submit";
  readonly prompt: string;
  readonly source?: string;
  readonly streaming_behavior?: string;
}

export interface PiTerminalTurnStopEvent extends PiTerminalEventBase {
  readonly event_name: "turn_stop";
  readonly turn_id?: string;
  readonly assistant_text?: string;
}

export interface PiTerminalTurnFailureEvent extends PiTerminalEventBase {
  readonly event_name: "turn_failure";
  readonly turn_id?: string;
  readonly message: string;
}

export interface PiTerminalRuntimeStateEvent extends PiTerminalEventBase {
  readonly event_name: "runtime_state";
  readonly model?: string;
  readonly model_provider?: string;
  readonly thinking_level?: string;
  readonly permission_mode?: string;
}

export interface PiTerminalSessionCompactEvent extends PiTerminalEventBase {
  readonly event_name: "session_compact";
  readonly reason: string;
  readonly will_retry: boolean;
}

export interface PiTerminalSessionShutdownEvent extends PiTerminalEventBase {
  readonly event_name: "session_shutdown";
  readonly reason: string;
  readonly target_session_file?: string;
}

export interface PiTerminalUnmanagedInputEvent extends PiTerminalEventBase {
  readonly event_name: "unmanaged_input";
  readonly prompt?: string;
}

export type PiTerminalEvent =
  | PiTerminalSessionStartEvent
  | PiTerminalPromptSubmitEvent
  | PiTerminalTurnStopEvent
  | PiTerminalTurnFailureEvent
  | PiTerminalRuntimeStateEvent
  | PiTerminalSessionCompactEvent
  | PiTerminalSessionShutdownEvent
  | PiTerminalUnmanagedInputEvent;

export interface PiTerminalBridgeResponse {
  readonly turnId?: string;
  readonly additionalContext?: string;
  readonly block?: { readonly message: string };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerString(value: unknown, field: string): string | undefined {
  return optionalBoundedHookString(value, `Pi terminal ${field}`);
}

function pathString(value: unknown, field: string): string | undefined {
  return optionalBoundedHookString(value, `Pi terminal ${field}`, TERMINAL_HOOK_PATH_MAX_CHARS);
}

function optionalFields(input: Record<string, unknown>) {
  const sessionId = providerString(input.session_id, "session id");
  const sessionFile = pathString(input.session_file, "session file");
  return {
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(sessionFile ? { session_file: sessionFile } : {}),
  };
}

export function parsePiTerminalEvent(value: unknown): PiTerminalEvent {
  const input = record(value);
  const eventName = optionalBoundedHookString(input?.event_name, "Pi terminal event name", 64);
  const eventId = optionalBoundedHookString(
    input?.event_id,
    "Pi terminal event id",
    TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
  );
  if (!input || !eventId || !PI_TERMINAL_EVENT_NAMES.includes(eventName as PiTerminalEventName)) {
    throw new Error("Invalid Pi terminal event.");
  }
  const base = { event_id: eventId, ...optionalFields(input) };
  switch (eventName) {
    case "session_start": {
      const sessionId = providerString(input.session_id, "session id");
      const reason = providerString(input.reason, "reason");
      if (!sessionId || !reason) {
        throw new Error("Invalid Pi session start event.");
      }
      const model = providerString(input.model, "model");
      const modelProvider = providerString(input.model_provider, "model provider");
      const thinkingLevel = providerString(input.thinking_level, "thinking level");
      const permissionMode = providerString(input.permission_mode, "permission mode");
      return {
        ...base,
        event_name: eventName,
        session_id: sessionId,
        reason,
        ...(model ? { model } : {}),
        ...(modelProvider ? { model_provider: modelProvider } : {}),
        ...(thinkingLevel ? { thinking_level: thinkingLevel } : {}),
        ...(permissionMode ? { permission_mode: permissionMode } : {}),
      };
    }
    case "prompt_submit": {
      if (typeof input.prompt !== "string") {
        throw new Error("Invalid Pi prompt submit event.");
      }
      const source = providerString(input.source, "prompt source");
      const streamingBehavior = providerString(input.streaming_behavior, "streaming behavior");
      return {
        ...base,
        event_name: eventName,
        prompt: input.prompt,
        ...(source ? { source } : {}),
        ...(streamingBehavior ? { streaming_behavior: streamingBehavior } : {}),
      };
    }
    case "turn_stop": {
      const turnId = providerString(input.turn_id, "turn id");
      return {
        ...base,
        event_name: eventName,
        ...(turnId ? { turn_id: turnId } : {}),
        ...(typeof input.assistant_text === "string"
          ? { assistant_text: input.assistant_text }
          : {}),
      };
    }
    case "turn_failure": {
      const message = providerString(input.message, "failure message");
      if (!message) throw new Error("Invalid Pi turn failure event.");
      const turnId = providerString(input.turn_id, "turn id");
      return {
        ...base,
        event_name: eventName,
        ...(turnId ? { turn_id: turnId } : {}),
        message,
      };
    }
    case "runtime_state": {
      const model = providerString(input.model, "model");
      const modelProvider = providerString(input.model_provider, "model provider");
      const thinkingLevel = providerString(input.thinking_level, "thinking level");
      const permissionMode = providerString(input.permission_mode, "permission mode");
      return {
        ...base,
        event_name: eventName,
        ...(model ? { model } : {}),
        ...(modelProvider ? { model_provider: modelProvider } : {}),
        ...(thinkingLevel ? { thinking_level: thinkingLevel } : {}),
        ...(permissionMode ? { permission_mode: permissionMode } : {}),
      };
    }
    case "session_compact": {
      const reason = providerString(input.reason, "compact reason");
      if (!reason || typeof input.will_retry !== "boolean") {
        throw new Error("Invalid Pi session compact event.");
      }
      return {
        ...base,
        event_name: eventName,
        reason,
        will_retry: input.will_retry,
      };
    }
    case "session_shutdown": {
      const reason = providerString(input.reason, "shutdown reason");
      if (!reason) throw new Error("Invalid Pi session shutdown event.");
      const targetSessionFile = pathString(input.target_session_file, "target session file");
      return {
        ...base,
        event_name: eventName,
        reason,
        ...(targetSessionFile ? { target_session_file: targetSessionFile } : {}),
      };
    }
    case "unmanaged_input":
      return {
        ...base,
        event_name: eventName,
        ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
      };
    default:
      throw new Error("Unsupported Pi terminal event.");
  }
}
import {
  optionalBoundedHookString,
  TERMINAL_HOOK_PATH_MAX_CHARS,
  TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS,
} from "./terminalAgentHookProtocolBounds";
