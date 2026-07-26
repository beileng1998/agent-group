import fs from "node:fs/promises";

import type {
  ProviderSession,
  TerminalAgentProvider,
  ThreadId,
} from "@agent-group/contracts";

import {
  findClaudeTranscriptPath,
  findCodexTranscriptPath,
} from "../provider/ProviderTranscriptPaths";
import type { TerminalAgentProviderResumeCursor } from "./terminalAgentProtocol";
import {
  terminalProviderResumeCursor,
  terminalProviderSessionId,
} from "./terminalAgentRuntimeState";

export interface TerminalAgentLaunchContinuity {
  readonly providerSessionId: string | null;
  readonly providerResumeCursor: TerminalAgentProviderResumeCursor | null;
  readonly resume: boolean;
}

function persistedCursor(
  sessions: ReadonlyArray<ProviderSession>,
  threadId: ThreadId,
  provider: TerminalAgentProvider,
  fallback: unknown,
): TerminalAgentProviderResumeCursor | null {
  const session = sessions.find(
    (candidate) =>
      candidate.threadId === threadId && candidate.provider === provider,
  );
  return terminalProviderResumeCursor(
    provider,
    session?.resumeCursor ?? fallback,
  );
}

export function resolveTerminalLaunchContinuity(input: {
  readonly sessions: ReadonlyArray<ProviderSession>;
  readonly threadId: ThreadId;
  readonly provider: TerminalAgentProvider;
  readonly operation: "start" | "restart";
  readonly providerSessionId: string | null;
  readonly resume: boolean;
  readonly persistedResumeCursor?: unknown;
}): TerminalAgentLaunchContinuity {
  const cursor = persistedCursor(
    input.sessions,
    input.threadId,
    input.provider,
    input.persistedResumeCursor,
  );
  if (
    input.provider === "pi" &&
    (typeof cursor === "string" || (cursor && "path" in cursor))
  ) {
    if (
      input.operation === "restart" &&
      input.providerSessionId !== null
    ) {
      return {
        providerSessionId: input.providerSessionId,
        providerResumeCursor: null,
        resume: true,
      };
    }
    return {
      providerSessionId:
        typeof cursor === "string" ? null : cursor.sessionId,
      providerResumeCursor: cursor,
      resume: true,
    };
  }
  const cursorSessionId = terminalProviderSessionId(input.provider, cursor);
  const providerSessionId =
    input.operation === "start"
      ? (cursorSessionId ?? input.providerSessionId)
      : (input.providerSessionId ?? cursorSessionId);
  return {
    providerSessionId,
    providerResumeCursor: cursor,
    resume: input.resume || cursor !== null,
  };
}

export async function resolveAvailableTerminalLaunchContinuity(
  input: Parameters<typeof resolveTerminalLaunchContinuity>[0] & {
    readonly homeDir: string;
    readonly codexHomePath?: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<TerminalAgentLaunchContinuity> {
  const continuity = resolveTerminalLaunchContinuity(input);
  if (input.operation !== "start" || !continuity.resume) {
    return continuity;
  }

  let available = true;
  if (input.provider === "codex" && continuity.providerSessionId) {
    available =
      (await findCodexTranscriptPath({
        providerThreadId: continuity.providerSessionId,
        ...(input.codexHomePath
          ? { homePath: input.codexHomePath }
          : {}),
        ...(input.env ? { env: input.env } : {}),
      })) !== null;
  } else if (
    input.provider === "claudeAgent" &&
    continuity.providerSessionId
  ) {
    available =
      (await findClaudeTranscriptPath({
        homeDir: input.homeDir,
        sessionId: continuity.providerSessionId,
        ...(input.env ? { env: input.env } : {}),
      })) !== null;
  } else if (
    input.provider === "pi" &&
    (typeof continuity.providerResumeCursor === "string" ||
      (continuity.providerResumeCursor &&
        "path" in continuity.providerResumeCursor))
  ) {
    const cursorPath =
      typeof continuity.providerResumeCursor === "string"
        ? continuity.providerResumeCursor
        : continuity.providerResumeCursor.path;
    try {
      await fs.lstat(cursorPath);
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !("code" in cause) ||
        cause.code !== "ENOENT"
      ) {
        return continuity;
      }
      available = false;
    }
  }
  if (available) {
    return continuity;
  }
  return {
    providerSessionId: input.providerSessionId,
    providerResumeCursor: null,
    resume: false,
  };
}
