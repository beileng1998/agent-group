import type {
  OrchestrationMessage,
  TerminalAgentProvider,
  TerminalAgentRuntimeState,
  ThreadId,
} from "@agent-group/contracts";

import type { ExecutionAdapterState } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { TerminalAgentProviderResumeCursor } from "./terminalAgentProtocol";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import type { ResolvedTerminalTarget } from "./terminalAgentRuntimeTypes";

const TRANSCRIPT_BOOTSTRAP_MAX_CHARS = 120_000;
const TRANSCRIPT_BOOTSTRAP_OMITTED_PREFIX = "[Earlier transcript omitted]\n\n";

function isVisibleTranscriptMessage(message: OrchestrationMessage): boolean {
  return (
    !message.streaming &&
    (message.role === "user" || message.role === "assistant") &&
    message.text.length > 0
  );
}

function suffixOfParts(parts: ReadonlyArray<string>, maximumChars: number): string {
  let remaining = maximumChars;
  const suffix: string[] = [];
  for (let index = parts.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const part = parts[index]!;
    const retained = part.slice(Math.max(0, part.length - remaining));
    suffix.push(retained);
    remaining -= retained.length;
  }
  return suffix.reverse().join("");
}

export function terminalProviderResumeCursor(
  provider: TerminalAgentProvider,
  resumeCursor: unknown,
): TerminalAgentProviderResumeCursor | null {
  if (provider === "pi") {
    if (typeof resumeCursor === "string" && resumeCursor.trim()) {
      return resumeCursor.trim();
    }
    if (resumeCursor && typeof resumeCursor === "object" && !Array.isArray(resumeCursor)) {
      const cursor = resumeCursor as Record<string, unknown>;
      if (
        typeof cursor.path === "string" &&
        cursor.path.trim() &&
        typeof cursor.sessionId === "string" &&
        cursor.sessionId.trim()
      ) {
        return {
          path: cursor.path.trim(),
          sessionId: cursor.sessionId.trim(),
        };
      }
    }
    return null;
  }
  if (!resumeCursor || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) {
    return null;
  }
  const cursor = resumeCursor as Record<string, unknown>;
  if (provider === "codex") {
    return typeof cursor.threadId === "string" && cursor.threadId.trim()
      ? { threadId: cursor.threadId.trim() }
      : null;
  }
  if (provider === "claudeAgent") {
    for (const key of ["resume", "sessionId"]) {
      const value = cursor[key];
      if (typeof value === "string" && value.trim()) {
        return { resume: value.trim() };
      }
    }
  }
  return null;
}

export function terminalProviderSessionId(
  provider: TerminalAgentProvider,
  resumeCursor: unknown,
): string | null {
  const cursor = terminalProviderResumeCursor(provider, resumeCursor);
  if (!cursor || typeof cursor === "string") return null;
  if ("sessionId" in cursor) return cursor.sessionId;
  return "threadId" in cursor ? cursor.threadId : cursor.resume;
}

export function visibleTranscriptBootstrap(
  messages: ReadonlyArray<OrchestrationMessage>,
): string | null {
  const retained: string[] = [];
  let remaining = TRANSCRIPT_BOOTSTRAP_MAX_CHARS;
  let omitted = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!isVisibleTranscriptMessage(message)) continue;
    if (remaining === 0) {
      omitted = true;
      break;
    }
    const heading = message.role === "user" ? "User:\n" : "Assistant:\n";
    const separator = retained.length > 0 ? "\n\n" : "";
    const chunkLength = heading.length + message.text.length + separator.length;
    if (chunkLength <= remaining) {
      retained.push(`${heading}${message.text}${separator}`);
      remaining -= chunkLength;
      continue;
    }
    retained.push(suffixOfParts([heading, message.text, separator], remaining));
    omitted = true;
    break;
  }

  if (retained.length === 0) return null;
  const visible = retained.reverse().join("");
  return omitted ? `${TRANSCRIPT_BOOTSTRAP_OMITTED_PREFIX}${visible}` : visible;
}

export function terminalAgentRuntimeState(input: {
  readonly threadId: ThreadId;
  readonly provider: TerminalAgentProvider;
  readonly authority: ExecutionAdapterState;
  readonly runtime: TerminalAgentRuntimeRecord | undefined;
}): TerminalAgentRuntimeState {
  const runtime = input.runtime;
  if (input.authority.adapter === "structured") {
    return {
      threadId: input.threadId,
      authority: "structured",
      revision: input.authority.revision,
      provider: input.provider,
      status: "idle",
      runtimeInstanceId: null,
      generation: null,
      pid: null,
      providerSessionId: null,
      model: runtime?.model ?? null,
      effort: runtime?.effort ?? null,
      permission: runtime?.permission ?? null,
      capabilities: runtime?.capabilities ?? null,
      exit: null,
      error: null,
    };
  }
  return {
    threadId: input.threadId,
    authority: "terminal",
    revision: input.authority.revision,
    provider: input.provider,
    status: input.authority.status === "deleting" ? "stopping" : input.authority.status,
    runtimeInstanceId: input.authority.runtimeInstanceId,
    generation: input.authority.generation,
    pid: input.authority.pid,
    providerSessionId: input.authority.providerSessionId,
    model: runtime?.model ?? null,
    effort: runtime?.effort ?? null,
    permission: runtime?.permission ?? null,
    capabilities: runtime?.capabilities ?? null,
    exit:
      input.authority.exitCode !== null || input.authority.exitSignal !== null
        ? {
            code: input.authority.exitCode,
            signal: input.authority.exitSignal,
          }
        : null,
    error: input.authority.error,
  };
}

export function makeTerminalAgentStateProjector(
  records: ReadonlyMap<ThreadId, TerminalAgentRuntimeRecord>,
) {
  return (
    target: ResolvedTerminalTarget,
    authority: ExecutionAdapterState,
  ): TerminalAgentRuntimeState =>
    terminalAgentRuntimeState({
      threadId: target.threadId,
      provider: target.provider,
      authority,
      runtime: records.get(target.threadId),
    });
}
