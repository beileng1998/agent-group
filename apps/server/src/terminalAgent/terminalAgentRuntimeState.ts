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

export function terminalProviderResumeCursor(
  provider: TerminalAgentProvider,
  resumeCursor: unknown,
): TerminalAgentProviderResumeCursor | null {
  if (provider === "pi") {
    if (typeof resumeCursor === "string" && resumeCursor.trim()) {
      return resumeCursor.trim();
    }
    if (
      resumeCursor &&
      typeof resumeCursor === "object" &&
      !Array.isArray(resumeCursor)
    ) {
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
  if (
    !resumeCursor ||
    typeof resumeCursor !== "object" ||
    Array.isArray(resumeCursor)
  ) {
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
  const visible = messages
    .filter(
      (message) =>
        !message.streaming &&
        (message.role === "user" || message.role === "assistant") &&
        message.text.length > 0,
    )
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}:\n${message.text}`)
    .join("\n\n");
  if (!visible) return null;
  const maximumChars = 120_000;
  return visible.length <= maximumChars
    ? visible
    : `[Earlier transcript omitted]\n\n${visible.slice(-maximumChars)}`;
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
