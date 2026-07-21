import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  RuntimeTaskId,
  type ModelCapabilities,
  type ProviderRuntimeEvent,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type { ClaudeSessionContext, ClaudeSubagentRun } from "./claudeAdapterRuntime.ts";
import { toError } from "./claudeAdapterErrors.ts";
import { asCanonicalTurnId } from "./claudeAdapterProtocol.ts";
import { nativeProviderRefs, sdkNativeMethod } from "./claudeSdkMessage.ts";
import {
  normalizeClaudeSubagentTerminalStatus,
  type ClaudeSubagentRouteLookup,
  type ClaudeSubagentTerminalStatus,
} from "./claudeSubagentRouting.ts";
import {
  readClaudeModelRefusalFallback,
  resolveClaudeApiModelIdContextWindowMaxTokens,
} from "./claudeTokenUsage.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeSystemMessageProjection(input: {
  readonly emitRuntimeError: (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ) => Effect.Effect<void>;
  readonly emitTaskUsageSnapshot: (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { subtype: "task_progress" | "task_notification" }>,
  ) => Effect.Effect<void>;
  readonly ensureSubagentRun: (
    context: ClaudeSessionContext,
    toolUseId: string,
  ) => ClaudeSubagentRun | undefined;
  readonly ensureSyntheticTurn: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly resolveModelCapabilities: (
    modelDiscoveryKey: string,
    model: string | undefined,
  ) => ModelCapabilities;
  readonly settleSubagentRun: (
    context: ClaudeSessionContext,
    lookup: ClaudeSubagentRouteLookup,
    status: ClaudeSubagentTerminalStatus,
    errorMessage?: string,
    options?: { readonly retainRun?: boolean },
  ) => Effect.Effect<void>;
  readonly updateResumeCursor: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly warnUnhandledSdkKind: (
    context: ClaudeSessionContext,
    kind: string,
    message: string,
    detail?: unknown,
  ) => Effect.Effect<void>;
}) {
  const handleSystemMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "system" || message.subtype === "thinking_tokens") {
        return;
      }

      if (message.subtype === "task_updated") {
        const status = normalizeClaudeSubagentTerminalStatus(message.patch?.status);
        if (status) {
          yield* input.settleSubagentRun(
            context,
            { taskId: message.task_id },
            status,
            status === "failed" ? message.patch?.error : undefined,
            { retainRun: true },
          );
        }
        return;
      }

      const stamp = yield* input.makeEventStamp();
      const base = {
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        providerRefs: nativeProviderRefs(context),
        raw: {
          source: "claude.sdk.message" as const,
          method: sdkNativeMethod(message),
          messageType: `${message.type}:${message.subtype}`,
          payload: message,
        },
      };

      const refusalFallback = readClaudeModelRefusalFallback(message);
      if (refusalFallback) {
        context.rerouteOriginalApiModelId ??= refusalFallback.originalModel;
        context.currentApiModelId = refusalFallback.fallbackModel;
        context.lastKnownContextWindow = resolveClaudeApiModelIdContextWindowMaxTokens(
          refusalFallback.fallbackModel,
          input.resolveModelCapabilities(
            context.modelDiscoveryKey,
            refusalFallback.fallbackModel,
          ),
        );
        yield* input.updateResumeCursor(context);
        yield* input.offerRuntimeEvent({
          ...base,
          type: "model.rerouted",
          payload: {
            fromModel: refusalFallback.originalModel,
            toModel: refusalFallback.fallbackModel,
            reason: refusalFallback.content ?? "Model safeguards rerouted this request.",
          },
        });
        return;
      }

      switch (message.subtype) {
        case "init":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "session.configured",
            payload: { config: message as Record<string, unknown> },
          });
          return;
        case "status":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "session.state.changed",
            payload: {
              state: message.status === "compacting" ? "waiting" : "running",
              reason: `status:${message.status ?? "active"}`,
              detail: message,
            },
          });
          return;
        case "compact_boundary":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "thread.state.changed",
            payload: { state: "compacted", detail: message },
          });
          return;
        case "hook_started":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "hook.started",
            payload: {
              hookId: message.hook_id,
              hookName: message.hook_name,
              hookEvent: message.hook_event,
            },
          });
          return;
        case "hook_progress":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "hook.progress",
            payload: {
              hookId: message.hook_id,
              output: message.output,
              stdout: message.stdout,
              stderr: message.stderr,
            },
          });
          return;
        case "hook_response":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "hook.completed",
            payload: {
              hookId: message.hook_id,
              outcome: message.outcome,
              output: message.output,
              stdout: message.stdout,
              stderr: message.stderr,
              ...(typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}),
            },
          });
          return;
        case "task_started": {
          const toolUseId = message.tool_use_id;
          if (
            toolUseId &&
            (message.subagent_type !== undefined ||
              context.subagentRoutes.resolveActive({ toolUseId }) !== undefined)
          ) {
            const run = input.ensureSubagentRun(context, toolUseId);
            const binding = run
              ? context.subagentRoutes.bindTask(toolUseId, message.task_id)
              : undefined;
            if (run) {
              yield* input.ensureSyntheticTurn(run.context);
            }
            if (binding?.stopRequested) {
              yield* Effect.tryPromise({
                try: () => context.query.stopTask(message.task_id),
                catch: (cause) => toError(cause, "Failed to stop Claude subagent task."),
              }).pipe(
                Effect.catch((cause) =>
                  input.emitRuntimeError(
                    context,
                    `Failed to stop subagent task '${message.task_id}'.`,
                    cause,
                  ),
                ),
              );
            }
          }
          yield* input.offerRuntimeEvent({
            ...base,
            type: "task.started",
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              description: message.description,
              ...(message.task_type ? { taskType: message.task_type } : {}),
              ...(message.subagent_type ? { subagentType: message.subagent_type } : {}),
              ...(toolUseId ? { toolUseId } : {}),
            },
          });
          return;
        }
        case "task_progress":
          yield* input.emitTaskUsageSnapshot(context, message);
          yield* input.offerRuntimeEvent({
            ...base,
            type: "task.progress",
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              description: message.description,
              ...(message.summary ? { summary: message.summary } : {}),
              ...(message.usage ? { usage: message.usage } : {}),
              ...(message.last_tool_name ? { lastToolName: message.last_tool_name } : {}),
              ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
            },
          });
          return;
        case "task_notification": {
          const activeRoute =
            (message.tool_use_id
              ? context.subagentRoutes.resolveActive({ toolUseId: message.tool_use_id })
              : undefined) ?? context.subagentRoutes.resolveActive({ taskId: message.task_id });
          const activeRun = activeRoute
            ? input.ensureSubagentRun(context, activeRoute.toolUseId)
            : undefined;
          if (activeRun) {
            if (message.tool_use_id) {
              context.subagentRoutes.bindTask(message.tool_use_id, message.task_id);
            }
            yield* input.ensureSyntheticTurn(activeRun.context);
          }
          yield* input.emitTaskUsageSnapshot(context, message);
          yield* input.offerRuntimeEvent({
            ...base,
            type: "task.completed",
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(message.task_id),
              status: message.status,
              ...(message.summary ? { summary: message.summary } : {}),
              ...(message.usage ? { usage: message.usage } : {}),
              ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
            },
          });
          yield* input.settleSubagentRun(
            context,
            { toolUseId: message.tool_use_id, taskId: message.task_id },
            message.status,
            message.status === "failed" ? message.summary : undefined,
          );
          return;
        }
        case "files_persisted":
          yield* input.offerRuntimeEvent({
            ...base,
            type: "files.persisted",
            payload: {
              files: Array.isArray(message.files)
                ? message.files.map((file: { filename: string; file_id: string }) => ({
                    filename: file.filename,
                    fileId: file.file_id,
                  }))
                : [],
              ...(Array.isArray(message.failed)
                ? {
                    failed: message.failed.map((entry: { filename: string; error: string }) => ({
                      filename: entry.filename,
                      error: entry.error,
                    })),
                  }
                : {}),
            },
          });
          return;
        default:
          yield* input.warnUnhandledSdkKind(
            context,
            `system:${message.subtype}`,
            `Unhandled Claude system message subtype '${message.subtype}'.`,
            message,
          );
      }
    });

  const handleTelemetryMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const stamp = yield* input.makeEventStamp();
      const base = {
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        providerRefs: nativeProviderRefs(context),
        raw: {
          source: "claude.sdk.message" as const,
          method: sdkNativeMethod(message),
          messageType: message.type,
          payload: message,
        },
      };

      if (message.type === "tool_progress") {
        yield* input.offerRuntimeEvent({
          ...base,
          type: "tool.progress",
          payload: {
            toolUseId: message.tool_use_id,
            toolName: message.tool_name,
            elapsedSeconds: message.elapsed_time_seconds,
            ...(message.task_id ? { summary: `task:${message.task_id}` } : {}),
          },
        });
      } else if (message.type === "tool_use_summary") {
        yield* input.offerRuntimeEvent({
          ...base,
          type: "tool.summary",
          payload: {
            summary: message.summary,
            ...(message.preceding_tool_use_ids.length > 0
              ? { precedingToolUseIds: message.preceding_tool_use_ids }
              : {}),
          },
        });
      } else if (message.type === "auth_status") {
        yield* input.offerRuntimeEvent({
          ...base,
          type: "auth.status",
          payload: {
            isAuthenticating: message.isAuthenticating,
            output: message.output,
            ...(message.error ? { error: message.error } : {}),
          },
        });
      } else if (message.type === "rate_limit_event") {
        yield* input.offerRuntimeEvent({
          ...base,
          type: "account.rate-limits.updated",
          payload: { rateLimits: message },
        });
      }
    });

  return { handleSystemMessage, handleTelemetryMessage };
}
