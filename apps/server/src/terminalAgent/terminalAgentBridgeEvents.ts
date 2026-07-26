import { parseClaudeHookInput, parseClaudeStatusLine } from "./claudeHookProtocol";
import { codexHookInputToTerminalEvent, parseCodexHookInput } from "./codexHookProtocol";
import { parsePiTerminalEvent, type PiTerminalEvent } from "./piTerminalProtocol";
import type { TerminalAgentBridgeRequest, TerminalAgentEvent } from "./terminalAgentProtocol";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

function assertSessionId(
  runtime: TerminalAgentRuntimeRecord,
  sessionId: string | undefined,
  isStart: boolean,
): void {
  if (
    !isStart &&
    sessionId &&
    runtime.providerSessionId &&
    sessionId !== runtime.providerSessionId
  ) {
    throw new Error("This hook belongs to an older Agent Session.");
  }
}

function claudeEvent(
  runtime: TerminalAgentRuntimeRecord,
  request: TerminalAgentBridgeRequest,
): TerminalAgentEvent | null {
  const input = parseClaudeHookInput(
    request.input,
    request.mode === "status-line" ? "status-line" : undefined,
  );
  assertSessionId(runtime, input.session_id, input.hook_event_name === "SessionStart");
  const base = request.eventId ? { eventId: request.eventId } : {};
  switch (input.hook_event_name) {
    case "SessionStart":
      return input.session_id
        ? {
            ...base,
            type: "session_start",
            providerSessionId: input.session_id,
            providerResumeCursor: { resume: input.session_id },
            reason: input.source ?? "startup",
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort?.level ? { effort: input.effort.level } : {}),
            ...(input.permission_mode ? { permissionMode: input.permission_mode } : {}),
          }
        : null;
    case "UserPromptSubmit":
      return input.prompt === undefined
        ? null
        : {
            ...base,
            type: "prompt_submit",
            prompt: input.prompt,
            ...(input.model ? { model: input.model } : {}),
            ...(input.permission_mode ? { permissionMode: input.permission_mode } : {}),
          };
    case "SubagentStart":
      return {
        ...base,
        type: "subagent_start",
        ...(input.agent_id ? { agentId: input.agent_id } : {}),
      };
    case "Stop":
      return {
        ...base,
        type: "turn_stop",
        ...(input.last_assistant_message !== undefined
          ? { assistantText: input.last_assistant_message }
          : {}),
        hasBackgroundWork:
          (input.background_tasks?.length ?? 0) > 0 || (input.session_crons?.length ?? 0) > 0,
      };
    case "StopFailure":
      return {
        ...base,
        type: "turn_failure",
        message: input.error_details ?? input.error ?? "The Agent Turn failed.",
      };
    case "SessionEnd":
      return { ...base, type: "session_end", ...(input.reason ? { reason: input.reason } : {}) };
    case "StatusLine":
      return { ...base, type: "runtime_state", ...parseClaudeStatusLine(input) };
  }
}

function piModel(event: PiTerminalEvent) {
  return {
    ...("model" in event && event.model ? { model: event.model } : {}),
    ...("thinking_level" in event && event.thinking_level ? { effort: event.thinking_level } : {}),
    ...("permission_mode" in event && event.permission_mode
      ? { permissionMode: event.permission_mode }
      : {}),
  };
}

function piEvent(
  runtime: TerminalAgentRuntimeRecord,
  request: TerminalAgentBridgeRequest,
): TerminalAgentEvent {
  const input = parsePiTerminalEvent(request.input);
  assertSessionId(
    runtime,
    "session_id" in input ? input.session_id : undefined,
    input.event_name === "session_start",
  );
  const base = { eventId: request.eventId ?? input.event_id };
  switch (input.event_name) {
    case "session_start":
      if (!input.session_file) {
        throw new Error("Pi session start is missing its durable session file.");
      }
      return {
        ...base,
        type: "session_start",
        providerSessionId: input.session_id,
        providerResumeCursor: input.session_file,
        reason: input.reason,
        ...piModel(input),
      };
    case "prompt_submit":
      return { ...base, type: "prompt_submit", prompt: input.prompt };
    case "turn_stop":
      return {
        ...base,
        type: "turn_stop",
        ...(input.turn_id ? { providerTurnId: input.turn_id } : {}),
        ...(input.assistant_text !== undefined ? { assistantText: input.assistant_text } : {}),
      };
    case "turn_failure":
      return {
        ...base,
        type: "turn_failure",
        ...(input.turn_id ? { providerTurnId: input.turn_id } : {}),
        message: input.message,
      };
    case "runtime_state":
      return { ...base, type: "runtime_state", ...piModel(input) };
    case "session_compact":
      return {
        ...base,
        type: "session_compact",
        reason: input.reason,
        willRetry: input.will_retry,
      };
    case "session_shutdown":
      return { ...base, type: "session_end", reason: input.reason };
    case "unmanaged_input":
      return {
        ...base,
        type: "unmanaged_input",
        message: "Pi rejected input that bypassed the managed prompt hook.",
      };
  }
}

function assertCurrentSession(
  runtime: TerminalAgentRuntimeRecord,
  event: TerminalAgentEvent,
): void {
  if (event.type === "session_start") return;
  if (!runtime.handshakeReceived) {
    throw new Error("Agent Group context is not ready yet.");
  }
}

export function parseTerminalAgentBridgeEvent(
  runtime: TerminalAgentRuntimeRecord,
  request: TerminalAgentBridgeRequest,
): TerminalAgentEvent {
  let event: TerminalAgentEvent | null;
  if (runtime.provider === "codex") {
    const input = parseCodexHookInput(request.input);
    assertSessionId(runtime, input.session_id, input.hook_event_name === "SessionStart");
    event = codexHookInputToTerminalEvent(input, request.eventId);
  } else {
    event =
      runtime.provider === "claudeAgent"
        ? claudeEvent(runtime, request)
        : piEvent(runtime, request);
  }
  if (!event) throw new Error("The Agent hook is missing required context.");
  assertCurrentSession(runtime, event);
  return event;
}
