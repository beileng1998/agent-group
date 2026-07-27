// Resolves app-owned Knowledge links into visible Side/child navigation and card markers.

import {
  MessageId,
  ThreadMarkerId,
  type AgentGroupKnowledgeLink,
  type ThreadId,
  type ThreadMarker,
} from "@agent-group/contracts";

import type { SidebarThreadSummary } from "../types";
import { isPromotedSidechatThread, isTemporarySidechatThread } from "../agentGroupCapabilities";
import { resolveTranscriptMarkerRange } from "../components/chat/chatSelectionActions";

export interface VisibleKnowledgeLink {
  link: AgentGroupKnowledgeLink;
  kind: "side" | "child";
  title: string;
}

export function resolveVisibleKnowledgeLinks(input: {
  links: readonly AgentGroupKnowledgeLink[];
  sourceSessionId: ThreadId;
  summaries: Readonly<Record<string, SidebarThreadSummary>>;
}): VisibleKnowledgeLink[] {
  return input.links.flatMap((link): VisibleKnowledgeLink[] => {
    const target = input.summaries[link.targetThreadId];
    if (!target || target.sidechatSourceThreadId !== input.sourceSessionId) return [];
    if (isPromotedSidechatThread(target)) {
      return [{ link, kind: "child" as const, title: target.title }];
    }
    if (isTemporarySidechatThread(target)) {
      return [{ link, kind: "side" as const, title: target.title }];
    }
    return [];
  });
}

export function buildKnowledgeLinkMarkers(input: {
  cardKey: string;
  cardBody: string;
  links: readonly VisibleKnowledgeLink[];
}): Array<{ marker: ThreadMarker; target: VisibleKnowledgeLink }> {
  return input.links.toReversed().flatMap((target) => {
    const selectedText = target.link.selectedText;
    if (!selectedText) return [];
    const hasStoredRange =
      target.link.selectionStartOffset !== null && target.link.selectionEndOffset !== null;
    const storedRange =
      hasStoredRange &&
      selectionMatches(
        input.cardBody.slice(
          target.link.selectionStartOffset!,
          target.link.selectionEndOffset!,
        ),
        selectedText,
      )
        ? {
            startOffset: target.link.selectionStartOffset!,
            endOffset: target.link.selectionEndOffset!,
          }
        : null;
    const range = resolveTranscriptMarkerRange({
      messageText: input.cardBody,
      selectedText,
      ...(storedRange ? { sourceRange: storedRange } : {}),
    });
    if (!range) return [];
    const rawSelectedText = input.cardBody.slice(range.startOffset, range.endOffset);
    const markerId = ThreadMarkerId.makeUnsafe(
      `knowledge-link:${input.cardKey}:${target.link.targetThreadId}`,
    );
    return [
      {
        target,
        marker: {
          id: markerId,
          messageId: MessageId.makeUnsafe(`knowledge-card:${input.cardKey}`),
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          selectedText: rawSelectedText,
          prefix: "",
          suffix: "",
          style: "underline",
          color: "blue",
          note: null,
          label: null,
          done: false,
          createdAt: target.link.createdAt,
          updatedAt: target.link.createdAt,
        },
      },
    ];
  });
}

function selectionMatches(rawText: string, renderedText: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return normalize(rawText) === normalize(renderedText);
}
