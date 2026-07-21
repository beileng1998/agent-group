import {
  type AssistantDeliveryMode,
  CommandId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderRuntimeEvent,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";

import { generatedImagePathFromRuntimeEvent } from "../codexGeneratedImages.ts";

export const DEFAULT_ASSISTANT_DELIVERY_MODE: AssistantDeliveryMode = "buffered";
export const STRICT_PROVIDER_LIFECYCLE_GUARD =
  process.env.AGENT_GROUP_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

export type RuntimeIngestionDomainEvent = Extract<
  OrchestrationEvent,
  {
    type: "thread.turn-start-requested" | "thread.reverted" | "thread.conversation-rolled-back";
  }
>;

export type RuntimeIngestionInput =
  | { readonly source: "runtime"; readonly event: ProviderRuntimeEvent }
  | { readonly source: "domain"; readonly event: RuntimeIngestionDomainEvent };

export const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;

export const providerCommandId = (event: ProviderRuntimeEvent, tag: string): CommandId =>
  CommandId.makeUnsafe(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`);

export function threadDetailFromShell(shell: OrchestrationThreadShell): OrchestrationThread {
  return {
    ...shell,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
  };
}

export function eventNeedsHeavyThreadDetail(event: ProviderRuntimeEvent): boolean {
  switch (event.type) {
    case "turn.proposed.completed":
    case "turn.completed":
    case "turn.aborted":
    case "turn.diff.updated":
    case "session.exited":
    case "runtime.error":
      return true;
    case "item.completed":
      return (
        event.payload.itemType === "assistant_message" ||
        generatedImagePathFromRuntimeEvent(event) !== undefined
      );
    default:
      return false;
  }
}

export function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.makeUnsafe(String(value));
}

export function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

export function inferRuntimeModeFromUserInputAnswers(
  answers: Record<string, unknown> | undefined,
): RuntimeMode | null {
  const sandboxMode = typeof answers?.sandbox_mode === "string" ? answers.sandbox_mode : null;
  const approvalPolicy =
    typeof answers?.approval_policy === "string" ? answers.approval_policy : null;
  if (sandboxMode === "danger-full-access") {
    return approvalPolicy === null || approvalPolicy === "never"
      ? "full-access"
      : "approval-required";
  }
  if (sandboxMode === "read-only" || sandboxMode === "workspace-write") {
    return "approval-required";
  }
  if (approvalPolicy === "never") return "full-access";
  if (
    approvalPolicy === "untrusted" ||
    approvalPolicy === "on-failure" ||
    approvalPolicy === "on-request"
  ) {
    return "approval-required";
  }
  return null;
}

export function hasRenderableAssistantText(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > 0;
}

export function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`;
}

export function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) return proposedPlanIdForTurn(threadId, turnId);
  if (event.itemId) return `plan:${threadId}:item:${event.itemId}`;
  return `plan:${threadId}:event:${event.eventId}`;
}

export function normalizeProposedPlanMarkdown(
  planMarkdown: string | undefined,
): string | undefined {
  const trimmed = planMarkdown?.trim();
  return trimmed || undefined;
}

export function normalizeIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function runtimePayloadRecord(
  event: ProviderRuntimeEvent,
): Record<string, unknown> | undefined {
  const payload = (event as { payload?: unknown }).payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function runtimeTurnState(
  event: ProviderRuntimeEvent,
): "completed" | "failed" | "interrupted" | "cancelled" {
  const value = asString(runtimePayloadRecord(event)?.state);
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

export function runtimeTurnErrorMessage(event: ProviderRuntimeEvent): string | undefined {
  return asString(runtimePayloadRecord(event)?.errorMessage);
}

export function runtimeErrorMessageFromEvent(event: ProviderRuntimeEvent): string | undefined {
  return asString(runtimePayloadRecord(event)?.message);
}

export function resolveTerminalTurnId(
  event: ProviderRuntimeEvent,
  activeTurnId: TurnId | null,
): TurnId | undefined {
  const eventTurnId = toTurnId(event.turnId);
  if (eventTurnId !== undefined) return eventTurnId;
  if (activeTurnId !== null && (event.type === "turn.completed" || event.type === "turn.aborted")) {
    return activeTurnId;
  }
  return undefined;
}

export function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  return state === "waiting" ? "running" : state;
}
