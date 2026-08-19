// Validates persisted app-owned learning metadata without touching context.md.

import { assertAgentGroupEntityId } from "./filesystem";

export interface StoredKnowledgeAcknowledgement {
  cardKey: string;
  cardMarkdown: string;
  acknowledgedAt: string;
}

export interface StoredLearningOrigin {
  sourceSessionId: string;
  sourceContextRevision: string;
  cardKey: string;
  cardTitle: string;
  cardMarkdown: string;
  selectedText: string | null;
  selectionStartOffset: number | null;
  selectionEndOffset: number | null;
}

export interface StoredKnowledgeLink {
  targetThreadId: string;
  sourceContextRevision: string;
  cardKey: string;
  cardTitle: string;
  selectedText: string | null;
  selectionStartOffset: number | null;
  selectionEndOffset: number | null;
  createdAt: string;
}

export function validateKnowledgeAcknowledgements(
  input: unknown,
  sessionId: string,
): StoredKnowledgeAcknowledgement[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 2_048) {
    throw new Error(`Invalid knowledge progress for '${sessionId}'`);
  }
  return input.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.cardKey !== "string" ||
      typeof value.cardMarkdown !== "string" ||
      typeof value.acknowledgedAt !== "string"
    ) {
      throw new Error(`Invalid knowledge progress for '${sessionId}'`);
    }
    return {
      cardKey: value.cardKey,
      cardMarkdown: value.cardMarkdown,
      acknowledgedAt: value.acknowledgedAt,
    };
  });
}

export function validateKnowledgeLinks(input: unknown, sessionId: string): StoredKnowledgeLink[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 128) {
    throw new Error(`Invalid knowledge links for '${sessionId}'`);
  }
  return input.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.targetThreadId !== "string" ||
      typeof value.sourceContextRevision !== "string" ||
      typeof value.cardKey !== "string" ||
      typeof value.cardTitle !== "string" ||
      (value.selectedText !== null && typeof value.selectedText !== "string") ||
      !isOptionalSelectionRange(value.selectionStartOffset, value.selectionEndOffset) ||
      typeof value.createdAt !== "string"
    ) {
      throw new Error(`Invalid knowledge links for '${sessionId}'`);
    }
    assertAgentGroupEntityId(value.targetThreadId, "knowledge target thread id");
    return {
      targetThreadId: value.targetThreadId,
      sourceContextRevision: value.sourceContextRevision,
      cardKey: value.cardKey,
      cardTitle: value.cardTitle,
      selectedText: value.selectedText,
      selectionStartOffset: value.selectionStartOffset as number | null,
      selectionEndOffset: value.selectionEndOffset as number | null,
      createdAt: value.createdAt,
    };
  });
}

export function validateLearningOrigin(
  input: unknown,
  sessionId: string,
): StoredLearningOrigin | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) {
    throw new Error(`Invalid learning origin for '${sessionId}'`);
  }
  const selectionStartOffset = input.selectionStartOffset ?? null;
  const selectionEndOffset = input.selectionEndOffset ?? null;
  if (
    typeof input.sourceSessionId !== "string" ||
    typeof input.sourceContextRevision !== "string" ||
    typeof input.cardKey !== "string" ||
    typeof input.cardTitle !== "string" ||
    typeof input.cardMarkdown !== "string" ||
    (input.selectedText !== null && typeof input.selectedText !== "string") ||
    !isOptionalSelectionRange(selectionStartOffset, selectionEndOffset)
  ) {
    throw new Error(`Invalid learning origin for '${sessionId}'`);
  }
  assertAgentGroupEntityId(input.sourceSessionId, "source session id");
  return {
    sourceSessionId: input.sourceSessionId,
    sourceContextRevision: input.sourceContextRevision,
    cardKey: input.cardKey,
    cardTitle: input.cardTitle,
    cardMarkdown: input.cardMarkdown,
    selectedText: input.selectedText,
    selectionStartOffset: selectionStartOffset as number | null,
    selectionEndOffset: selectionEndOffset as number | null,
  };
}

function isOptionalSelectionRange(start: unknown, end: unknown): boolean {
  if (start === null && end === null) return true;
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start as number) >= 0 &&
    (end as number) > (start as number)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
