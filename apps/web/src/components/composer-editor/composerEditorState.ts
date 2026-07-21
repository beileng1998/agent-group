import type { MessageMentionReference } from "@agent-group/contracts";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
} from "lexical";

import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import {
  $createComposerAgentMentionNode,
  $createComposerLinkNode,
  $createComposerMentionNode,
  $createComposerSkillNode,
  $createComposerSlashCommandNode,
  $createComposerTerminalContextNode,
  ComposerAgentMentionNode,
  ComposerLinkNode,
  ComposerMentionNode,
  ComposerSkillNode,
  ComposerSlashCommandNode,
  ComposerTerminalContextNode,
  isComposerInlineTokenNode,
  type ComposerInlineTokenNode,
} from "../composer-nodes";

export function terminalContextSignature(contexts: ReadonlyArray<TerminalContextDraft>): string {
  return contexts
    .map((context) =>
      [
        context.id,
        context.threadId,
        context.terminalId,
        context.terminalLabel,
        context.lineStart,
        context.lineEnd,
        context.createdAt,
        context.text,
      ].join("\u001f"),
    )
    .join("\u001e");
}

export function mentionReferencesSignature(
  mentions: ReadonlyArray<MessageMentionReference>,
): string {
  return mentions
    .map((mention) =>
      "path" in mention
        ? `provider\u0000${mention.name}\u0000${mention.path}`
        : `session\u0000${mention.name}\u0000${mention.sessionId}`,
    )
    .join("\u0001");
}

export function clampExpandedCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.max(0, Math.min(value.length, Math.floor(cursor)));
}

function getComposerInlineTokenTextLength(_node: ComposerInlineTokenNode): 1 {
  return 1;
}

function getComposerInlineTokenExpandedTextLength(node: ComposerInlineTokenNode): number {
  return node.getTextContentSize();
}

function getAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number,
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenTextLength(node) : 0);
}

function getExpandedAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number,
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenExpandedTextLength(node) : 0);
}

function findSelectionPointForInlineToken(
  node: ComposerInlineTokenNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "element" } | null {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return null;
  const index = node.getIndexWithinParent();
  if (remainingRef.value === 0) {
    return { key: parent.getKey(), offset: index, type: "element" };
  }
  if (remainingRef.value === getComposerInlineTokenTextLength(node)) {
    return { key: parent.getKey(), offset: index + 1, type: "element" };
  }
  remainingRef.value -= getComposerInlineTokenTextLength(node);
  return null;
}

function getComposerNodeTextLength(node: LexicalNode): number {
  if (isComposerInlineTokenNode(node)) return getComposerInlineTokenTextLength(node);
  if ($isTextNode(node)) return node.getTextContentSize();
  if ($isLineBreakNode(node)) return 1;
  if ($isElementNode(node)) {
    return node.getChildren().reduce((total, child) => total + getComposerNodeTextLength(child), 0);
  }
  return 0;
}

function getComposerNodeExpandedTextLength(node: LexicalNode): number {
  if (isComposerInlineTokenNode(node)) return getComposerInlineTokenExpandedTextLength(node);
  if ($isTextNode(node)) return node.getTextContentSize();
  if ($isLineBreakNode(node)) return 1;
  if ($isElementNode(node)) {
    return node
      .getChildren()
      .reduce((total, child) => total + getComposerNodeExpandedTextLength(child), 0);
  }
  return 0;
}

export function getAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  let offset = 0;
  let current: LexicalNode | null = node;

  while (current) {
    const nextParent = current.getParent() as LexicalNode | null;
    if (!nextParent || !$isElementNode(nextParent)) break;
    const siblings = nextParent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (sibling) offset += getComposerNodeTextLength(sibling);
    }
    current = nextParent;
  }

  if (node instanceof ComposerLinkNode || node instanceof ComposerTerminalContextNode) {
    return getAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
  }
  if ($isTextNode(node)) {
    if (
      node instanceof ComposerMentionNode ||
      node instanceof ComposerSkillNode ||
      node instanceof ComposerSlashCommandNode ||
      node instanceof ComposerAgentMentionNode
    ) {
      return getAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
    }
    return offset + Math.min(pointOffset, node.getTextContentSize());
  }
  if ($isLineBreakNode(node)) return offset + Math.min(pointOffset, 1);
  if ($isElementNode(node)) {
    const children = node.getChildren();
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length));
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i];
      if (child) offset += getComposerNodeTextLength(child);
    }
  }
  return offset;
}

function getExpandedAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  let offset = 0;
  let current: LexicalNode | null = node;

  while (current) {
    const nextParent = current.getParent() as LexicalNode | null;
    if (!nextParent || !$isElementNode(nextParent)) break;
    const siblings = nextParent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (sibling) offset += getComposerNodeExpandedTextLength(sibling);
    }
    current = nextParent;
  }

  if (node instanceof ComposerLinkNode || node instanceof ComposerTerminalContextNode) {
    return getExpandedAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
  }
  if ($isTextNode(node)) {
    if (
      node instanceof ComposerMentionNode ||
      node instanceof ComposerSkillNode ||
      node instanceof ComposerSlashCommandNode ||
      node instanceof ComposerAgentMentionNode
    ) {
      return getExpandedAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
    }
    return offset + Math.min(pointOffset, node.getTextContentSize());
  }
  if ($isLineBreakNode(node)) return offset + Math.min(pointOffset, 1);
  if ($isElementNode(node)) {
    const children = node.getChildren();
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length));
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i];
      if (child) offset += getComposerNodeExpandedTextLength(child);
    }
  }
  return offset;
}

function findSelectionPointAtOffset(
  node: LexicalNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "text" | "element" } | null {
  if (isComposerInlineTokenNode(node)) {
    return findSelectionPointForInlineToken(node, remainingRef);
  }
  if ($isTextNode(node)) {
    const size = node.getTextContentSize();
    if (remainingRef.value <= size) {
      return { key: node.getKey(), offset: remainingRef.value, type: "text" };
    }
    remainingRef.value -= size;
    return null;
  }
  if ($isLineBreakNode(node)) {
    const parent = node.getParent();
    if (!parent) return null;
    const index = node.getIndexWithinParent();
    if (remainingRef.value === 0) {
      return { key: parent.getKey(), offset: index, type: "element" };
    }
    if (remainingRef.value === 1) {
      return { key: parent.getKey(), offset: index + 1, type: "element" };
    }
    remainingRef.value -= 1;
    return null;
  }
  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) {
      const point = findSelectionPointAtOffset(child, remainingRef);
      if (point) return point;
    }
    if (remainingRef.value === 0) {
      return { key: node.getKey(), offset: children.length, type: "element" };
    }
  }
  return null;
}

export function $getComposerRootLength(): number {
  return $getRoot()
    .getChildren()
    .reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
}

export function $setSelectionAtComposerOffset(nextOffset: number): void {
  const root = $getRoot();
  const composerLength = $getComposerRootLength();
  const remainingRef = { value: Math.max(0, Math.min(nextOffset, composerLength)) };
  const point = findSelectionPointAtOffset(root, remainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: "element" as const,
  };
  const selection = $createRangeSelection();
  selection.anchor.set(point.key, point.offset, point.type);
  selection.focus.set(point.key, point.offset, point.type);
  $setSelection(selection);
}

export function $readSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return fallback;
  const offset = getAbsoluteOffsetForPoint(selection.anchor.getNode(), selection.anchor.offset);
  return Math.max(0, Math.min(offset, $getComposerRootLength()));
}

export function $readExpandedSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return fallback;
  const offset = getExpandedAbsoluteOffsetForPoint(
    selection.anchor.getNode(),
    selection.anchor.offset,
  );
  return Math.max(0, Math.min(offset, $getRoot().getTextContent().length));
}

function $appendTextWithLineBreaks(parent: ElementNode, text: string): void {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 0) parent.append($createTextNode(line));
    if (index < lines.length - 1) parent.append($createLineBreakNode());
  }
}

export function $setComposerEditorPrompt(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  mentionReferences: ReadonlyArray<MessageMentionReference> = [],
): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);

  const segments = splitPromptIntoComposerSegments(prompt, terminalContexts, mentionReferences);
  for (const segment of segments) {
    if (segment.type === "mention") {
      paragraph.append($createComposerMentionNode(segment.path, segment.kind));
    } else if (segment.type === "skill") {
      paragraph.append($createComposerSkillNode(`${segment.prefix ?? "$"}${segment.name}`));
    } else if (segment.type === "slash-command") {
      paragraph.append($createComposerSlashCommandNode(segment.command));
    } else if (segment.type === "terminal-context") {
      if (segment.context) paragraph.append($createComposerTerminalContextNode(segment.context));
    } else if (segment.type === "agent-mention") {
      paragraph.append($createComposerAgentMentionNode(segment.alias, segment.color));
    } else if (segment.type === "link") {
      paragraph.append($createComposerLinkNode(segment.url));
    } else {
      $appendTextWithLineBreaks(paragraph, segment.text);
    }
  }
}

export function collectTerminalContextIds(node: LexicalNode): string[] {
  if (node instanceof ComposerTerminalContextNode) return [node.__context.id];
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => collectTerminalContextIds(child));
  }
  return [];
}
