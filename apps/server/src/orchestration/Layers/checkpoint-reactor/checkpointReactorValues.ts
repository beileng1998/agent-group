import {
  CommandId,
  type MessageId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";

export type CheckpointReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

export const ASSISTANT_MESSAGE_ID_RETRY_DELAY_MS = 20;
export const ASSISTANT_MESSAGE_ID_RETRY_ATTEMPTS = 6;

export function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.makeUnsafe(String(value));
}

export function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

export function checkpointStatusFromRuntime(
  status: string | undefined,
): "ready" | "missing" | "error" {
  switch (status) {
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "missing";
    case "completed":
    default:
      return "ready";
  }
}

export const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

export function resolveExistingAssistantMessageIdForTurn(
  thread:
    | {
        readonly messages: ReadonlyArray<{
          readonly id: MessageId;
          readonly role: string;
          readonly turnId: TurnId | null;
        }>;
      }
    | undefined,
  turnId: TurnId,
  assistantMessageId: MessageId | undefined,
): MessageId | undefined {
  if (!thread || assistantMessageId === undefined) {
    return undefined;
  }
  return thread.messages.some(
    (entry) =>
      entry.id === assistantMessageId && entry.role === "assistant" && entry.turnId === turnId,
  )
    ? assistantMessageId
    : undefined;
}

export interface CheckpointReactorState {
  readonly pendingMessageStartByThread: Map<ThreadId, MessageId>;
  readonly liveDiffScheduledThreads: Set<ThreadId>;
}

export function makeCheckpointReactorState(): CheckpointReactorState {
  return {
    pendingMessageStartByThread: new Map(),
    liveDiffScheduledThreads: new Set(),
  };
}
