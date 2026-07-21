import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";

import type { ClaudeSessionContext, ClaudeSubagentRun } from "./claudeAdapterRuntime.ts";
import { readClaudeSubagentParentToolUseId } from "./claudeSubagentRouting.ts";

type MessageHandler = (context: ClaudeSessionContext, message: SDKMessage) => Effect.Effect<void>;

export function makeClaudeSdkMessageRouter(input: {
  readonly ensureSubagentRun: (
    context: ClaudeSessionContext,
    toolUseId: string,
  ) => ClaudeSubagentRun | undefined;
  readonly ensureSyntheticTurn: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly ensureThreadId: MessageHandler;
  readonly handleAssistantMessage: MessageHandler;
  readonly handleResultMessage: MessageHandler;
  readonly handleStreamEvent: MessageHandler;
  readonly handleSystemMessage: MessageHandler;
  readonly handleTelemetryMessage: MessageHandler;
  readonly handleUserMessage: MessageHandler;
  readonly logNativeSdkMessage: MessageHandler;
  readonly warnUnhandledSdkKind: (
    context: ClaudeSessionContext,
    kind: string,
    message: string,
    detail?: unknown,
  ) => Effect.Effect<void>;
}) {
  return (context: ClaudeSessionContext, message: SDKMessage): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* input.logNativeSdkMessage(context, message);

      const subagentToolUseId = readClaudeSubagentParentToolUseId(message);
      if (subagentToolUseId) {
        if (context.subagentRoutes.settledStatus({ toolUseId: subagentToolUseId })) {
          return;
        }
        const run = input.ensureSubagentRun(context, subagentToolUseId);
        if (!run) {
          return;
        }
        yield* input.ensureSyntheticTurn(run.context);
        switch (message.type) {
          case "stream_event":
            yield* input.handleStreamEvent(run.context, message);
            return;
          case "user":
            yield* input.handleUserMessage(run.context, message);
            return;
          case "assistant":
            yield* input.handleAssistantMessage(run.context, message);
            return;
          case "tool_progress":
            yield* input.handleTelemetryMessage(run.context, message);
            return;
        }
      }

      yield* input.ensureThreadId(context, message);
      switch (message.type) {
        case "stream_event":
          yield* input.handleStreamEvent(context, message);
          return;
        case "user":
          yield* input.handleUserMessage(context, message);
          return;
        case "assistant":
          yield* input.handleAssistantMessage(context, message);
          return;
        case "result":
          yield* input.handleResultMessage(context, message);
          return;
        case "system":
          yield* input.handleSystemMessage(context, message);
          return;
        case "tool_progress":
        case "tool_use_summary":
        case "auth_status":
        case "rate_limit_event":
          yield* input.handleTelemetryMessage(context, message);
          return;
        default:
          yield* input.warnUnhandledSdkKind(
            context,
            `type:${message.type}`,
            `Unhandled Claude SDK message type '${message.type}'.`,
            message,
          );
      }
    });
}
