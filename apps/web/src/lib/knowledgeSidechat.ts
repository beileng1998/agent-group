// Bridges a Knowledge card snapshot into Side without coupling it to context.md.

import type {
  AgentGroupLearningOrigin,
  ThreadHandoffImportedMessage,
  ThreadId,
} from "@agent-group/contracts";

import type { ChatMessage } from "../types";
import { newMessageId } from "./utils";

const SOURCE_PREFIX = "<!-- agent-group-knowledge-source:";
const SOURCE_PATTERN = /^<!-- agent-group-knowledge-source:([A-Za-z0-9_-]+) -->/;
const CARD_MARKER = "<!-- agent-group-knowledge-card -->";
const SELECTION_START = "<!-- agent-group-knowledge-selection-start -->";
const SELECTION_END = "<!-- agent-group-knowledge-selection-end -->";

interface KnowledgeSourceMetadata {
  sourceSessionId: string;
  sourceContextRevision: string;
  cardKey: string;
  cardTitle: string;
  hasSelection: boolean;
  selectionStartOffset: number | null;
  selectionEndOffset: number | null;
}

export type KnowledgeSidechatSource = AgentGroupLearningOrigin;

export function buildKnowledgeSourceImportedMessage(
  source: KnowledgeSidechatSource,
  createdAt: string,
): ThreadHandoffImportedMessage {
  const metadata: KnowledgeSourceMetadata = {
    sourceSessionId: source.sourceSessionId,
    sourceContextRevision: source.sourceContextRevision,
    cardKey: source.cardKey,
    cardTitle: source.cardTitle,
    hasSelection: source.selectedText !== null,
    selectionStartOffset: source.selectionStartOffset ?? null,
    selectionEndOffset: source.selectionEndOffset ?? null,
  };
  const selection = source.selectedText
    ? [
        "",
        "Selected passage:",
        "",
        SELECTION_START,
        quoteMarkdown(source.selectedText),
        SELECTION_END,
      ]
    : [];
  return {
    messageId: newMessageId(),
    role: "user",
    text: [
      `${SOURCE_PREFIX}${encodeSource(metadata)} -->`,
      "",
      `Knowledge source: **${escapeInline(source.cardTitle)}**`,
      ...selection,
      "",
      CARD_MARKER,
      source.cardMarkdown,
    ].join("\n"),
    createdAt,
    updatedAt: createdAt,
  };
}

export function findKnowledgeSidechatSource(
  messages: readonly Pick<ChatMessage, "role" | "source" | "text">[],
): KnowledgeSidechatSource | null {
  for (const message of messages) {
    if (message.source !== "fork-import") continue;
    const source = parseKnowledgeSourceMessage(message.text);
    if (source) return source;
  }
  return null;
}

export function findOriginalSideQuestion(
  messages: readonly Pick<ChatMessage, "role" | "source" | "text">[],
): string | null {
  return (
    messages.find((message) => message.role === "user" && message.source !== "fork-import")?.text ??
    null
  );
}

export function parseKnowledgeSourceMessage(text: string): KnowledgeSidechatSource | null {
  const match = text.match(SOURCE_PATTERN);
  if (!match) return null;
  try {
    const value = JSON.parse(decodeSource(match[1]!)) as unknown;
    if (!isKnowledgeSourceMetadata(value)) return null;
    const cardBoundary = `\n${CARD_MARKER}\n`;
    const cardStart = text.indexOf(cardBoundary);
    if (cardStart < 0) return null;
    const cardMarkdown = text.slice(cardStart + cardBoundary.length);
    if (!cardMarkdown.trim()) return null;
    const selectedText = value.hasSelection ? parseSelectedText(text) : null;
    if (value.hasSelection && selectedText === null) return null;
    return {
      sourceSessionId: value.sourceSessionId as ThreadId,
      sourceContextRevision: value.sourceContextRevision,
      cardKey: value.cardKey,
      cardTitle: value.cardTitle,
      cardMarkdown,
      selectedText,
      selectionStartOffset: value.selectionStartOffset ?? null,
      selectionEndOffset: value.selectionEndOffset ?? null,
    };
  } catch {
    return null;
  }
}

function encodeSource(source: KnowledgeSourceMetadata): string {
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeSource(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isKnowledgeSourceMetadata(value: unknown): value is KnowledgeSourceMetadata {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<Record<keyof KnowledgeSourceMetadata, unknown>>;
  return (
    typeof source.sourceSessionId === "string" &&
    typeof source.sourceContextRevision === "string" &&
    typeof source.cardKey === "string" &&
    typeof source.cardTitle === "string" &&
    typeof source.hasSelection === "boolean" &&
    isOptionalSelectionRange(source.selectionStartOffset, source.selectionEndOffset)
  );
}

function isOptionalSelectionRange(start: unknown, end: unknown): boolean {
  if ((start === undefined || start === null) && (end === undefined || end === null)) return true;
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start as number) >= 0 &&
    (end as number) > (start as number)
  );
}

function parseSelectedText(text: string): string | null {
  const startBoundary = `${SELECTION_START}\n`;
  const endBoundary = `\n${SELECTION_END}`;
  const start = text.indexOf(startBoundary);
  const end = text.indexOf(endBoundary, start + startBoundary.length);
  if (start < 0 || end < 0) return null;
  const quotedLines = text
    .slice(start + startBoundary.length, end)
    .split("\n");
  if (quotedLines.some((line) => !line.startsWith("> "))) return null;
  return quotedLines.map((line) => line.slice(2)).join("\n");
}

function quoteMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeInline(text: string): string {
  return text.replace(/\s+/g, " ").trim().replaceAll("\\", "\\\\").replaceAll("*", "\\*");
}

export function makeLearningOrigin(input: {
  sourceSessionId: ThreadId;
  sourceContextRevision: string;
  cardKey: string;
  cardTitle: string;
  cardMarkdown: string;
  selectedText?: string | null;
  selectionStartOffset?: number | null;
  selectionEndOffset?: number | null;
}): KnowledgeSidechatSource {
  return {
    sourceSessionId: input.sourceSessionId,
    sourceContextRevision: input.sourceContextRevision,
    cardKey: input.cardKey,
    cardTitle: input.cardTitle,
    cardMarkdown: input.cardMarkdown,
    selectedText: input.selectedText ?? null,
    selectionStartOffset: input.selectionStartOffset ?? null,
    selectionEndOffset: input.selectionEndOffset ?? null,
  };
}
