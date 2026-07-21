import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent, ThreadId, TurnId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { hasDurableClaudeSessionId } from "./claudeAdapterProtocol.ts";
import { ProviderAdapterValidationError } from "./Errors.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeSessionState(input: {
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}) {
  const snapshotThread = (
    context: ClaudeSessionContext,
  ): Effect.Effect<
    {
      threadId: ThreadId;
      turns: ReadonlyArray<{
        id: TurnId;
        items: ReadonlyArray<unknown>;
      }>;
    },
    ProviderAdapterValidationError
  > =>
    Effect.gen(function* () {
      const threadId = context.session.threadId;
      if (!threadId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "readThread",
          issue: "Session thread id is not initialized yet.",
        });
      }
      return {
        threadId,
        turns: context.turns.map((turn) => ({
          id: turn.id,
          items: [...turn.items],
        })),
      };
    });

  const updateResumeCursor = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const threadId = context.session.threadId;
      if (!threadId) return;

      const resumeCursor = {
        threadId,
        ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
        ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
        turnCount: context.turns.length,
        ...(context.rerouteOriginalApiModelId && context.currentApiModelId
          ? {
              rerouteOriginalApiModelId: context.rerouteOriginalApiModelId,
              rerouteFallbackApiModelId: context.currentApiModelId,
            }
          : {}),
        ...(context.trackedTasks.size > 0
          ? { trackedTasks: Array.from(context.trackedTasks.values()) }
          : {}),
      };

      context.session = {
        ...context.session,
        resumeCursor,
        updatedAt: yield* input.nowIso,
      };
    });

  const ensureThreadId = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (
        typeof message.session_id !== "string" ||
        message.session_id.length === 0 ||
        !hasDurableClaudeSessionId(message)
      ) {
        return;
      }
      const nextThreadId = message.session_id;
      context.resumeSessionId = message.session_id;
      yield* updateResumeCursor(context);

      if (context.lastThreadStartedId === nextThreadId) {
        return;
      }
      context.lastThreadStartedId = nextThreadId;
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "thread.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: { providerThreadId: nextThreadId },
        providerRefs: {},
        raw: {
          source: "claude.sdk.message",
          method: "claude/thread/started",
          payload: { session_id: message.session_id },
        },
      });
    });

  return { ensureThreadId, snapshotThread, updateResumeCursor };
}
