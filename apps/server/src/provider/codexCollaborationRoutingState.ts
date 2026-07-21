import { type ProviderItemId, type TurnId } from "@agent-group/contracts";
import { decodeSubagentReceiverThreadIds } from "@agent-group/shared/subagents";

import {
  type CodexCollaborationRoute,
  resolveCodexCollaborationRoute as resolveRoute,
} from "../codexCollaborationRouting.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readObject, readString } from "./codexJsonValues.ts";
import {
  normalizeProviderThreadId,
  readResumeThreadId,
  toProviderItemId,
  toTurnId,
} from "./codexManagerValues.ts";

export function readRouteFields(params: unknown): {
  turnId?: TurnId;
  itemId?: ProviderItemId;
} {
  const route: {
    turnId?: TurnId;
    itemId?: ProviderItemId;
  } = {};

  const turnId = toTurnId(
    readString(params, "turnId") ?? readString(readObject(params, "turn"), "id"),
  );
  const itemId = toProviderItemId(
    readString(params, "itemId") ?? readString(readObject(params, "item"), "id"),
  );

  if (turnId) {
    route.turnId = turnId;
  }

  if (itemId) {
    route.itemId = itemId;
  }

  return route;
}

export function readProviderConversationId(params: unknown): string | undefined {
  return (
    readString(params, "threadId") ??
    readString(readObject(params, "thread"), "id") ??
    readString(params, "conversationId")
  );
}

export function readChildParentTurnId(
  context: CodexSessionContext,
  params: unknown,
): TurnId | undefined {
  const providerConversationId = readProviderConversationId(params);
  if (!providerConversationId) {
    return undefined;
  }
  return context.collabReceiverTurns.get(providerConversationId);
}

export function readChildParentProviderThreadId(
  context: CodexSessionContext,
  params: unknown,
): string | undefined {
  const providerConversationId = readProviderConversationId(params);
  if (!providerConversationId) {
    return undefined;
  }
  return context.collabReceiverParents.get(providerConversationId);
}

export function resolveCollaborationRoute(
  context: CodexSessionContext,
  params: unknown,
): CodexCollaborationRoute {
  const parentTurnId = readChildParentTurnId(context, params);
  const providerThreadId = normalizeProviderThreadId(readProviderConversationId(params));
  const mappedProviderParentThreadId = readChildParentProviderThreadId(context, params);
  const activeProviderThreadId = normalizeProviderThreadId(
    readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    }),
  );
  return resolveRoute({
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(providerThreadId ? { providerThreadId } : {}),
    ...(mappedProviderParentThreadId ? { mappedProviderParentThreadId } : {}),
    ...(activeProviderThreadId ? { activeProviderThreadId } : {}),
    hasActiveParentTurn:
      context.session.status === "running" && context.session.activeTurnId !== undefined,
  });
}

export function rememberCollabReceiverTurns(
  context: CodexSessionContext,
  params: unknown,
  parentTurnId: TurnId | undefined,
): void {
  if (!parentTurnId) {
    return;
  }
  const payload = readObject(params);
  const item = readObject(payload, "item") ?? payload;
  const itemType = readString(item, "type") ?? readString(item, "kind");
  if (itemType !== "collabAgentToolCall" && itemType !== "collabToolCall") {
    return;
  }
  const parentProviderThreadId = normalizeProviderThreadId(readProviderConversationId(params));

  const receiverThreadIds = decodeSubagentReceiverThreadIds(item);
  for (const receiverThreadId of receiverThreadIds) {
    context.collabReceiverTurns.set(receiverThreadId, parentTurnId);
    if (parentProviderThreadId) {
      context.collabReceiverParents.set(receiverThreadId, parentProviderThreadId);
    }
  }
}

export function shouldSuppressChildConversationNotification(method: string): boolean {
  // Intentionally do NOT suppress `turn/plan/updated` or `item/plan/delta` here,
  // even for child conversations. These are the events that let the active plan
  // card advance ("1 out of 5" → "2 out of 5" ...) and render streaming plan text;
  // suppressing them freezes the plan UI at its initial all-pending snapshot.
  return (
    method === "thread/started" ||
    method === "thread/status/changed" ||
    method === "thread/archived" ||
    method === "thread/unarchived" ||
    method === "thread/closed" ||
    method === "thread/compacted" ||
    method === "thread/name/updated" ||
    method === "thread/tokenUsage/updated" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "turn/aborted"
  );
}
