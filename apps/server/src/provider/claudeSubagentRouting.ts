import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeTurnStatus } from "@agent-group/contracts";

export type ClaudeSubagentTerminalStatus = "completed" | "failed" | "stopped";

export type ClaudeSubagentReceiverMetadata = Readonly<Record<string, unknown>> & {
  readonly receiverThreadId: string;
  readonly agentType?: string;
  readonly nickname?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly background?: true;
};

export interface ClaudeSubagentTool {
  readonly itemId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ClaudeSubagentRoute {
  readonly toolUseId: string;
  readonly taskId?: string;
}

export interface ClaudeSubagentTaskBinding {
  readonly route: ClaudeSubagentRoute;
  readonly stopRequested: boolean;
}

export interface ClaudeSubagentSettlement {
  readonly route: ClaudeSubagentRoute;
  readonly status: ClaudeSubagentTerminalStatus;
}

export type ClaudeSubagentStopDecision =
  | {
      readonly kind: "ready";
      readonly toolUseId: string;
      readonly taskId: string;
    }
  | {
      readonly kind: "pending";
      readonly toolUseId: string;
    }
  | {
      readonly kind: "settled";
      readonly toolUseId: string;
      readonly status: ClaudeSubagentTerminalStatus;
    }
  | { readonly kind: "ignored" };

export interface ClaudeSubagentRouteLookup {
  readonly toolUseId?: unknown;
  readonly taskId?: unknown;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function firstNonEmptyString(
  input: Readonly<Record<string, unknown>>,
  ...keys: ReadonlyArray<string>
): string | undefined {
  for (const key of keys) {
    const value = readNonEmptyString(input[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function readClaudeSubagentParentToolUseId(message: SDKMessage): string | undefined {
  if (
    message.type !== "assistant" &&
    message.type !== "user" &&
    message.type !== "stream_event" &&
    message.type !== "tool_progress"
  ) {
    return undefined;
  }
  return readNonEmptyString(message.parent_tool_use_id);
}

export function buildClaudeSubagentReceiverMetadata(
  tool: ClaudeSubagentTool,
): ClaudeSubagentReceiverMetadata | undefined {
  const receiverThreadId = readNonEmptyString(tool.itemId);
  if (!receiverThreadId) {
    return undefined;
  }

  const agentType = firstNonEmptyString(
    tool.input,
    "subagent_type",
    "subagentType",
    "agent_type",
    "agentType",
  );
  const nickname = firstNonEmptyString(tool.input, "description", "nickname", "name");
  const prompt = firstNonEmptyString(tool.input, "prompt");
  const model = firstNonEmptyString(tool.input, "model");
  const background =
    tool.input.run_in_background === true ||
    tool.input.runInBackground === true ||
    tool.input.background === true;

  return {
    receiverThreadId,
    ...(agentType ? { agentType } : {}),
    ...(nickname ? { nickname } : {}),
    ...(prompt ? { prompt } : {}),
    ...(model ? { model } : {}),
    ...(background ? { background: true } : {}),
  };
}

export function normalizeClaudeSubagentTerminalStatus(
  status: unknown,
): ClaudeSubagentTerminalStatus | undefined {
  switch (status) {
    case "completed":
    case "failed":
    case "stopped":
      return status;
    case "killed":
      return "stopped";
    default:
      return undefined;
  }
}

export function claudeSubagentTurnStatus(
  status: ClaudeSubagentTerminalStatus,
): ProviderRuntimeTurnStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "interrupted";
  }
}

/**
 * Session-scoped routing state for Claude Task/Agent tool runs.
 *
 * A tool-use id exists before the SDK task id. Mappings remain after settlement
 * so late SDK messages can be recognized and cannot reopen a finished child run.
 */
export class ClaudeSubagentRouteRegistry {
  readonly #routesByToolUseId = new Map<string, ClaudeSubagentRoute>();
  readonly #toolUseIdByTaskId = new Map<string, string>();
  readonly #pendingStops = new Set<string>();
  readonly #settledByToolUseId = new Map<string, ClaudeSubagentTerminalStatus>();

  registerToolUse(toolUseId: unknown): ClaudeSubagentRoute | undefined {
    const normalizedToolUseId = readNonEmptyString(toolUseId);
    if (!normalizedToolUseId || this.#settledByToolUseId.has(normalizedToolUseId)) {
      return undefined;
    }

    const existing = this.#routesByToolUseId.get(normalizedToolUseId);
    if (existing) {
      return existing;
    }

    const route = { toolUseId: normalizedToolUseId };
    this.#routesByToolUseId.set(normalizedToolUseId, route);
    return route;
  }

  bindTask(toolUseId: unknown, taskId: unknown): ClaudeSubagentTaskBinding | undefined {
    const normalizedToolUseId = readNonEmptyString(toolUseId);
    const normalizedTaskId = readNonEmptyString(taskId);
    if (!normalizedToolUseId || !normalizedTaskId) {
      return undefined;
    }

    const existingRoute = this.#routesByToolUseId.get(normalizedToolUseId);
    const mappedToolUseId = this.#toolUseIdByTaskId.get(normalizedTaskId);
    if (
      this.#settledByToolUseId.has(normalizedToolUseId) ||
      (existingRoute?.taskId !== undefined && existingRoute.taskId !== normalizedTaskId) ||
      (mappedToolUseId !== undefined && mappedToolUseId !== normalizedToolUseId)
    ) {
      return undefined;
    }

    const route = existingRoute ?? this.registerToolUse(normalizedToolUseId);
    if (!route) {
      return undefined;
    }

    const boundRoute =
      route.taskId === normalizedTaskId
        ? route
        : { toolUseId: normalizedToolUseId, taskId: normalizedTaskId };
    this.#routesByToolUseId.set(normalizedToolUseId, boundRoute);
    this.#toolUseIdByTaskId.set(normalizedTaskId, normalizedToolUseId);

    return {
      route: boundRoute,
      stopRequested: this.#pendingStops.delete(normalizedToolUseId),
    };
  }

  resolveActive(input: ClaudeSubagentRouteLookup): ClaudeSubagentRoute | undefined {
    const route = this.#resolveKnown(input);
    return route && !this.#settledByToolUseId.has(route.toolUseId) ? route : undefined;
  }

  resolve(input: ClaudeSubagentRouteLookup): ClaudeSubagentRoute | undefined {
    return this.#resolveKnown(input);
  }

  requestStop(toolUseId: unknown): ClaudeSubagentStopDecision {
    const normalizedToolUseId = readNonEmptyString(toolUseId);
    if (!normalizedToolUseId) {
      return { kind: "ignored" };
    }

    const settledStatus = this.#settledByToolUseId.get(normalizedToolUseId);
    if (settledStatus) {
      return { kind: "settled", toolUseId: normalizedToolUseId, status: settledStatus };
    }

    const taskId = this.#routesByToolUseId.get(normalizedToolUseId)?.taskId;
    if (taskId) {
      return { kind: "ready", toolUseId: normalizedToolUseId, taskId };
    }

    this.#pendingStops.add(normalizedToolUseId);
    return { kind: "pending", toolUseId: normalizedToolUseId };
  }

  settle(
    input: ClaudeSubagentRouteLookup,
    rawStatus: unknown,
  ): ClaudeSubagentSettlement | undefined {
    const status = normalizeClaudeSubagentTerminalStatus(rawStatus);
    const toolUseId = readNonEmptyString(input.toolUseId);
    const taskId = readNonEmptyString(input.taskId);
    if (!status || (!toolUseId && !taskId)) {
      return undefined;
    }

    let route = this.#resolveKnown({ toolUseId, taskId });
    if (!route && toolUseId && !this.#settledByToolUseId.has(toolUseId)) {
      const routeForToolUseId = this.#routesByToolUseId.get(toolUseId);
      const toolUseIdForTask = taskId ? this.#toolUseIdByTaskId.get(taskId) : undefined;
      if (
        (routeForToolUseId?.taskId !== undefined && routeForToolUseId.taskId !== taskId) ||
        (toolUseIdForTask !== undefined && toolUseIdForTask !== toolUseId)
      ) {
        return undefined;
      }
      route = this.registerToolUse(toolUseId);
    }
    if (!route) {
      return undefined;
    }

    if (taskId) {
      const binding = this.bindTask(route.toolUseId, taskId);
      if (!binding) {
        return undefined;
      }
      route = binding.route;
    }

    this.#pendingStops.delete(route.toolUseId);
    this.#settledByToolUseId.set(route.toolUseId, status);
    return { route, status };
  }

  settledStatus(input: ClaudeSubagentRouteLookup): ClaudeSubagentTerminalStatus | undefined {
    const route = this.#resolveKnown(input);
    return route ? this.#settledByToolUseId.get(route.toolUseId) : undefined;
  }

  #resolveKnown(input: ClaudeSubagentRouteLookup): ClaudeSubagentRoute | undefined {
    const toolUseId = readNonEmptyString(input.toolUseId);
    const taskId = readNonEmptyString(input.taskId);
    const routeFromToolUseId = toolUseId ? this.#routesByToolUseId.get(toolUseId) : undefined;
    const mappedToolUseId = taskId ? this.#toolUseIdByTaskId.get(taskId) : undefined;
    const routeFromTaskId = mappedToolUseId
      ? this.#routesByToolUseId.get(mappedToolUseId)
      : undefined;

    if (
      routeFromToolUseId &&
      routeFromTaskId &&
      routeFromToolUseId.toolUseId !== routeFromTaskId.toolUseId
    ) {
      return undefined;
    }
    if (toolUseId && routeFromTaskId && routeFromTaskId.toolUseId !== toolUseId) {
      return undefined;
    }
    if (routeFromToolUseId && taskId && routeFromToolUseId.taskId !== taskId) {
      return undefined;
    }
    return routeFromToolUseId ?? routeFromTaskId;
  }
}
