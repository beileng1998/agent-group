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

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalFields(input: Record<string, unknown>) {
  const sessionId = nonEmptyString(input.session_id);
  const sessionFile = nonEmptyString(input.session_file);
  return {
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(sessionFile ? { session_file: sessionFile } : {}),
  };
}

export function parsePiTerminalEvent(value: unknown): PiTerminalEvent {
  const input = record(value);
  const eventName = nonEmptyString(input?.event_name);
  const eventId = nonEmptyString(input?.event_id);
  if (
    !input ||
    !eventId ||
    !PI_TERMINAL_EVENT_NAMES.includes(eventName as PiTerminalEventName)
  ) {
    throw new Error("Invalid Pi terminal event.");
  }
  const base = { event_id: eventId, ...optionalFields(input) };
  switch (eventName) {
    case "session_start": {
      const sessionId = nonEmptyString(input.session_id);
      const reason = nonEmptyString(input.reason);
      if (!sessionId || !reason) {
        throw new Error("Invalid Pi session start event.");
      }
      const model = nonEmptyString(input.model);
      const modelProvider = nonEmptyString(input.model_provider);
      const thinkingLevel = nonEmptyString(input.thinking_level);
      const permissionMode = nonEmptyString(input.permission_mode);
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
      const source = nonEmptyString(input.source);
      const streamingBehavior = nonEmptyString(input.streaming_behavior);
      return {
        ...base,
        event_name: eventName,
        prompt: input.prompt,
        ...(source ? { source } : {}),
        ...(streamingBehavior
          ? { streaming_behavior: streamingBehavior }
          : {}),
      };
    }
    case "turn_stop": {
      const turnId = nonEmptyString(input.turn_id);
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
      const message = nonEmptyString(input.message);
      if (!message) throw new Error("Invalid Pi turn failure event.");
      const turnId = nonEmptyString(input.turn_id);
      return {
        ...base,
        event_name: eventName,
        ...(turnId ? { turn_id: turnId } : {}),
        message,
      };
    }
    case "runtime_state": {
      const model = nonEmptyString(input.model);
      const modelProvider = nonEmptyString(input.model_provider);
      const thinkingLevel = nonEmptyString(input.thinking_level);
      const permissionMode = nonEmptyString(input.permission_mode);
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
      const reason = nonEmptyString(input.reason);
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
      const reason = nonEmptyString(input.reason);
      if (!reason) throw new Error("Invalid Pi session shutdown event.");
      const targetSessionFile = nonEmptyString(input.target_session_file);
      return {
        ...base,
        event_name: eventName,
        reason,
        ...(targetSessionFile
          ? { target_session_file: targetSessionFile }
          : {}),
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
