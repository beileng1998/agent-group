import type { TurnId } from "@agent-group/contracts";

import type { CodexThreadSnapshot, CodexThreadTurnSnapshot } from "./codexManagerProtocol.ts";
import type { CodexJsonRpcNotification as JsonRpcNotification } from "./codexJsonRpc.ts";
import { readObject, readString } from "./codexJsonValues.ts";

export function isExitedReviewModeNotification(notification: JsonRpcNotification): boolean {
  if (notification.method !== "item/completed") {
    return false;
  }
  const item = readObject(notification.params, "item");
  const itemType = readString(item, "type") ?? readString(item, "kind");
  return itemType === "exitedReviewMode";
}

export function isTurnInterruptTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Timed out waiting for turn/interrupt");
}

export function normalizeItemType(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function turnHasReviewItem(
  turn: CodexThreadTurnSnapshot,
  itemType: "entered" | "exited",
): boolean {
  return turn.items.some((item) => {
    const record = readObject(item);
    const normalized = normalizeItemType(readString(record, "type") ?? readString(record, "kind"));
    return itemType === "entered"
      ? normalized.includes("entered review mode")
      : normalized.includes("exited review mode");
  });
}

export function findLatestReviewTurnId(snapshot: CodexThreadSnapshot): TurnId | undefined {
  const latestReviewTurn = [...snapshot.turns]
    .reverse()
    .find((turn) => turnHasReviewItem(turn, "entered"));
  return latestReviewTurn?.id;
}

export function isExitedReviewTurn(snapshot: CodexThreadSnapshot, turnId: TurnId): boolean {
  const turn = snapshot.turns.find((entry) => entry.id === turnId);
  return turn ? turnHasReviewItem(turn, "exited") : false;
}
