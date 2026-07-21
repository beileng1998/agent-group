import {
  type CanonicalItemType,
  type CanonicalRequestType,
  type ProviderEvent,
  type ProviderUserInputAnswers,
  type ThreadTokenUsageSnapshot,
  ProviderItemId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  TurnId,
} from "@agent-group/contracts";

import { isCodexGeneratedImageItemType } from "../codexGeneratedImages.ts";
import { isNonFatalCodexErrorMessage } from "../codexErrorClassification.ts";

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function codexHomePathFromRuntimePayload(value: unknown): string | undefined {
  const providerOptions = asObject(asObject(value)?.providerOptions);
  const codexOptions = asObject(providerOptions?.codex);
  const homePath = codexOptions?.homePath;
  return typeof homePath === "string" && homePath.trim() ? homePath.trim() : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function providerErrorMapsToWarning(event: ProviderEvent): boolean {
  return (
    event.kind === "error" &&
    event.method === "error" &&
    typeof event.message === "string" &&
    isNonFatalCodexErrorMessage(event.message)
  );
}

export function normalizeCodexTokenUsage(value: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = asObject(value);
  const totalUsage = asObject(usage?.total_token_usage ?? usage?.total);
  const lastUsage = asObject(usage?.last_token_usage ?? usage?.last);

  const totalProcessedTokens =
    asNumber(totalUsage?.total_tokens) ?? asNumber(totalUsage?.totalTokens);
  const usedTokens =
    asNumber(lastUsage?.total_tokens) ?? asNumber(lastUsage?.totalTokens) ?? totalProcessedTokens;
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined;
  }

  const maxTokens = asNumber(usage?.model_context_window) ?? asNumber(usage?.modelContextWindow);
  const inputTokens = asNumber(lastUsage?.input_tokens) ?? asNumber(lastUsage?.inputTokens);
  const cachedInputTokens =
    asNumber(lastUsage?.cached_input_tokens) ?? asNumber(lastUsage?.cachedInputTokens);
  const outputTokens = asNumber(lastUsage?.output_tokens) ?? asNumber(lastUsage?.outputTokens);
  const reasoningOutputTokens =
    asNumber(lastUsage?.reasoning_output_tokens) ?? asNumber(lastUsage?.reasoningOutputTokens);

  return {
    usedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(usedTokens !== undefined ? { lastUsedTokens: usedTokens } : {}),
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined
      ? { lastReasoningOutputTokens: reasoningOutputTokens }
      : {}),
    compactsAutomatically: true,
  };
}

export function toTurnId(value: string | undefined): TurnId | undefined {
  return value?.trim() ? TurnId.makeUnsafe(value) : undefined;
}

export function toProviderItemId(value: string | undefined): ProviderItemId | undefined {
  return value?.trim() ? ProviderItemId.makeUnsafe(value) : undefined;
}

export function toTurnStatus(value: unknown): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (value) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return value;
    default:
      return "completed";
  }
}

export function normalizeItemType(raw: unknown): string {
  const type = asString(raw);
  if (!type) return "item";
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toCanonicalItemType(raw: unknown): CanonicalItemType {
  const type = normalizeItemType(raw);
  if (isCodexGeneratedImageItemType(raw)) return "image_generation";
  if (type.includes("user")) return "user_message";
  if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
  if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
  if (type.includes("plan") || type.includes("todo")) return "plan";
  if (type.includes("command")) return "command_execution";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit"))
    return "file_change";
  if (type.includes("mcp")) return "mcp_tool_call";
  if (type.includes("dynamic tool")) return "dynamic_tool_call";
  if (type.includes("collab")) return "collab_agent_tool_call";
  if (type.includes("web search")) return "web_search";
  if (type.includes("image")) return "image_view";
  if (type.includes("review entered") || type.includes("entered review")) return "review_entered";
  if (type.includes("review exited") || type.includes("exited review")) return "review_exited";
  if (type.includes("compact")) return "context_compaction";
  if (type.includes("error")) return "error";
  return "unknown";
}

export function itemTitle(itemType: CanonicalItemType): string | undefined {
  switch (itemType) {
    case "assistant_message":
      return "Assistant message";
    case "user_message":
      return "User message";
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "dynamic_tool_call":
      return "Tool call";
    case "web_search":
      return "Web search";
    case "image_generation":
      return "Generated image";
    case "image_view":
      return "Image view";
    case "error":
      return "Error";
    default:
      return undefined;
  }
}

export function joinedTextParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const object = asObject(entry);
      return asString(object?.text) ?? asString(object?.summary);
    })
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function reasoningSummaryDetail(item: Record<string, unknown>): string | undefined {
  return asString(item.summary)?.trim() || joinedTextParts(item.summary);
}

export function itemDetail(
  item: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | undefined {
  const nestedResult = asObject(item.result);
  const candidates = [
    asString(item.command),
    asString(item.title),
    asString(item.summary),
    joinedTextParts(item.summary),
    joinedTextParts(item.content),
    asString(item.review),
    asString(item.text),
    asString(item.saved_path),
    asString(item.savedPath),
    asString(item.path),
    asString(item.file_path),
    asString(item.prompt),
    asString(nestedResult?.command),
    asString(payload.command),
    asString(payload.message),
    asString(payload.prompt),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    return trimmed;
  }
  return undefined;
}

export function itemStatus(
  lifecycle: "item.started" | "item.updated" | "item.completed",
  rawStatus: unknown,
): "inProgress" | "completed" | "failed" | "declined" | undefined {
  if (lifecycle === "item.started") {
    return "inProgress";
  }
  if (lifecycle === "item.updated") {
    return undefined;
  }
  return rawStatus === "failed" || rawStatus === "declined" ? rawStatus : "completed";
}

export function toRequestTypeFromMethod(method: string): CanonicalRequestType {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution_approval";
    case "item/fileRead/requestApproval":
      return "file_read_approval";
    case "item/fileChange/requestApproval":
      return "file_change_approval";
    case "applyPatchApproval":
      return "apply_patch_approval";
    case "execCommandApproval":
      return "exec_command_approval";
    case "item/tool/requestUserInput":
      return "tool_user_input";
    case "item/tool/call":
      return "dynamic_tool_call";
    case "account/chatgptAuthTokens/refresh":
      return "auth_tokens_refresh";
    default:
      return "unknown";
  }
}

export function toRequestTypeFromKind(kind: unknown): CanonicalRequestType {
  switch (kind) {
    case "command":
      return "command_execution_approval";
    case "file-read":
      return "file_read_approval";
    case "file-change":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

export function toRequestTypeFromResolvedPayload(
  payload: Record<string, unknown> | undefined,
): CanonicalRequestType {
  const request = asObject(payload?.request);
  const method = asString(request?.method) ?? asString(payload?.method);
  if (method) {
    return toRequestTypeFromMethod(method);
  }
  const requestKind = asString(request?.kind) ?? asString(payload?.requestKind);
  if (requestKind) {
    return toRequestTypeFromKind(requestKind);
  }
  return "unknown";
}

export function toCanonicalUserInputAnswers(
  answers: ProviderUserInputAnswers | undefined,
): ProviderUserInputAnswers {
  if (!answers) {
    return {};
  }

  const result: Record<string, string | ReadonlyArray<string> | null> = {};
  for (const [questionId, value] of Object.entries(answers)) {
    if (typeof value === "string") {
      result[questionId] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const normalized = value.filter((entry): entry is string => typeof entry === "string");
      result[questionId] = normalized.length === 1 ? normalized[0]! : normalized;
      continue;
    }

    const nestedAnswers = asArray(asObject(value)?.answers);
    if (nestedAnswers) {
      const normalized = nestedAnswers.filter(
        (entry): entry is string => typeof entry === "string",
      );
      result[questionId] = normalized.length === 1 ? normalized[0]! : normalized;
      continue;
    }
  }
  return result;
}

export function toUserInputQuestions(payload: Record<string, unknown> | undefined) {
  const questions = asArray(payload?.questions);
  if (!questions) {
    return undefined;
  }

  const parsedQuestions = questions
    .map((entry) => {
      const question = asObject(entry);
      if (!question) return undefined;
      const options = asArray(question.options)
        ?.map((option) => {
          const optionRecord = asObject(option);
          if (!optionRecord) return undefined;
          const label = asString(optionRecord.label)?.trim();
          const description = asString(optionRecord.description)?.trim();
          if (!label || !description) {
            return undefined;
          }
          return { label, description };
        })
        .filter((option): option is { label: string; description: string } => option !== undefined);
      const id = asString(question.id)?.trim();
      const header = asString(question.header)?.trim();
      const prompt = asString(question.question)?.trim();
      if (!id || !header || !prompt || !options || options.length === 0) {
        return undefined;
      }
      return {
        id,
        header,
        question: prompt,
        options,
        ...(question.multiSelect === true ? { multiSelect: true } : {}),
      };
    })
    .filter(
      (
        question,
      ): question is {
        id: string;
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
      } => question !== undefined,
    );

  return parsedQuestions.length > 0 ? parsedQuestions : undefined;
}

export function toThreadState(
  value: unknown,
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" {
  switch (value) {
    case "idle":
      return "idle";
    case "archived":
      return "archived";
    case "closed":
      return "closed";
    case "compacted":
      return "compacted";
    case "error":
    case "failed":
      return "error";
    default:
      return "active";
  }
}

export function contentStreamKindFromMethod(
  method: string,
):
  | "assistant_text"
  | "reasoning_text"
  | "reasoning_summary_text"
  | "plan_text"
  | "command_output"
  | "file_change_output" {
  switch (method) {
    case "item/agentMessage/delta":
      return "assistant_text";
    case "item/reasoning/textDelta":
      return "reasoning_text";
    case "item/reasoning/summaryTextDelta":
      return "reasoning_summary_text";
    case "item/commandExecution/outputDelta":
      return "command_output";
    case "item/fileChange/outputDelta":
      return "file_change_output";
    default:
      return "assistant_text";
  }
}

export function asRuntimeItemId(itemId: ProviderItemId): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(itemId);
}

export function asRuntimeRequestId(requestId: string): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(requestId);
}

export function asRuntimeTaskId(taskId: string): RuntimeTaskId {
  return RuntimeTaskId.makeUnsafe(taskId);
}

export function codexEventMessage(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return asObject(payload?.msg);
}
