import type {
  ModelInfo,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ApprovalRequestId,
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  type TurnId,
} from "@agent-group/contracts";

import { parseClaudeTrackedTasks, type ClaudeTrackedTask } from "./claudeTaskTracker.ts";
import { knownClaudeModelCapabilities } from "./claudeRuntimeModelCapabilities.ts";
import { readNonEmptyString, stripClaudeContextWindowSuffix } from "./claudeTokenUsage.ts";

export interface ClaudeResumeState {
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
  readonly rerouteOriginalApiModelId?: string;
  readonly rerouteFallbackApiModelId?: string;
  readonly trackedTasks?: ReadonlyArray<ClaudeTrackedTask>;
}

export function mapSupportedCommands(commands: SlashCommand[]): ProviderListCommandsResult {
  return {
    commands: commands.map((command) => ({
      name: command.name,
      description: command.description || undefined,
    })),
    source: "claudeAgent",
    cached: false,
  };
}

export function mapSupportedModels(models: ModelInfo[]): ProviderListModelsResult {
  const resolvedModels: Array<ProviderListModelsResult["models"][number]> = [];
  const indexBySlug = new Map<string, number>();
  const orderedModels = [
    ...models.filter((model) => model.value.trim().toLowerCase() !== "default"),
    ...models.filter((model) => model.value.trim().toLowerCase() === "default"),
  ];
  for (const model of orderedModels) {
    const resolvedModel = model.resolvedModel?.trim() || model.value.trim();
    const slug = stripClaudeContextWindowSuffix(resolvedModel);
    if (!slug) continue;
    const isDefaultAlias = model.value.trim().toLowerCase() === "default";
    const displayName = model.displayName.trim();
    const description = model.description.trim();
    const supportedReasoningEfforts = model.supportedEffortLevels?.map((value) => ({
      value,
      label: value === "xhigh" ? "Extra High" : value.charAt(0).toUpperCase() + value.slice(1),
    }));
    const candidate: ProviderListModelsResult["models"][number] = {
      slug,
      name: isDefaultAlias || !displayName ? slug : displayName,
      ...(description ? { description } : {}),
      ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
      ...(supportedReasoningEfforts?.some((effort) => effort.value === "high")
        ? { defaultReasoningEffort: "high" }
        : {}),
      ...(model.supportsFastMode !== undefined ? { supportsFastMode: model.supportsFastMode } : {}),
      ...(model.supportsAdaptiveThinking !== undefined
        ? { supportsAdaptiveThinking: model.supportsAdaptiveThinking }
        : {}),
    };
    const existingIndex = indexBySlug.get(slug);
    if (existingIndex === undefined) {
      indexBySlug.set(slug, resolvedModels.length);
      resolvedModels.push(candidate);
      continue;
    }
    const existing = resolvedModels[existingIndex]!;
    const effortByValue = new Map(
      [
        ...(existing.supportedReasoningEfforts ?? []),
        ...(candidate.supportedReasoningEfforts ?? []),
      ].map((effort) => [effort.value, effort]),
    );
    resolvedModels[existingIndex] = {
      ...candidate,
      ...existing,
      ...(effortByValue.size > 0 ? { supportedReasoningEfforts: [...effortByValue.values()] } : {}),
      ...(existing.supportsFastMode === true || candidate.supportsFastMode === true
        ? { supportsFastMode: true }
        : {}),
      ...(existing.supportsAdaptiveThinking === true || candidate.supportsAdaptiveThinking === true
        ? { supportsAdaptiveThinking: true }
        : {}),
    };
  }
  return {
    models: resolvedModels.map((model) => ({
      ...knownClaudeModelCapabilities(model.slug),
      ...model,
    })),
    source: "sdk",
    cached: false,
  };
}

export function neverResolvingUserMessageStream(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return { next: async () => new Promise<IteratorResult<SDKUserMessage>>(() => {}) };
    },
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

export function hasDurableClaudeSessionId(message: SDKMessage): boolean {
  if (message.type !== "system") return true;
  return (
    message.subtype !== "hook_started" &&
    message.subtype !== "hook_progress" &&
    message.subtype !== "hook_response"
  );
}

export function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(value);
}

export function asCanonicalTurnId(value: TurnId): TurnId {
  return value;
}

export function asRuntimeRequestId(value: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(value);
}

export function toPermissionMode(value: unknown): PermissionMode | undefined {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
    case "dontAsk":
      return value;
    default:
      return undefined;
  }
}

export function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") return undefined;
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
    rerouteOriginalApiModelId?: unknown;
    rerouteFallbackApiModelId?: unknown;
    trackedTasks?: unknown;
  };
  const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : undefined;
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.makeUnsafe(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt =
    typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : undefined;
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;
  const rerouteOriginalApiModelId = readNonEmptyString(cursor.rerouteOriginalApiModelId);
  const rerouteFallbackApiModelId = readNonEmptyString(cursor.rerouteFallbackApiModelId);
  const hasCompleteReroute =
    rerouteOriginalApiModelId !== undefined && rerouteFallbackApiModelId !== undefined;
  const trackedTasks = parseClaudeTrackedTasks(cursor.trackedTasks);
  return {
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnCountValue !== undefined && Number.isInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
    ...(hasCompleteReroute ? { rerouteOriginalApiModelId, rerouteFallbackApiModelId } : {}),
    ...(trackedTasks.length > 0 ? { trackedTasks } : {}),
  };
}
