import { ThreadId, type AgentGroupKnowledgeLink } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { SidebarThreadSummary } from "../types";
import { buildKnowledgeLinkMarkers, resolveVisibleKnowledgeLinks } from "./knowledgeCardLinks";

const SOURCE_ID = ThreadId.makeUnsafe("learning-parent");

function link(targetThreadId: string, selectedText: string | null): AgentGroupKnowledgeLink {
  return {
    targetThreadId: ThreadId.makeUnsafe(targetThreadId),
    sourceContextRevision: "revision-1",
    cardKey: "attention\n1",
    cardTitle: "Attention",
    selectedText,
    selectionStartOffset: selectedText ? 8 : null,
    selectionEndOffset: selectedText ? 17 : null,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function summary(input: {
  id: string;
  parentThreadId: string | null;
  forkSourceThreadId: string | null;
}): SidebarThreadSummary {
  return {
    id: ThreadId.makeUnsafe(input.id),
    title: input.id,
    sidechatSourceThreadId: SOURCE_ID,
    parentThreadId: input.parentThreadId ? ThreadId.makeUnsafe(input.parentThreadId) : null,
    forkSourceThreadId: input.forkSourceThreadId
      ? ThreadId.makeUnsafe(input.forkSourceThreadId)
      : null,
  } as SidebarThreadSummary;
}

describe("Knowledge card links", () => {
  it("distinguishes temporary Side from promoted child using the same target id", () => {
    const side = link("side-1", "attention");
    const child = link("child-1", null);
    const visible = resolveVisibleKnowledgeLinks({
      links: [side, child],
      sourceSessionId: SOURCE_ID,
      summaries: {
        "side-1": summary({
          id: "side-1",
          parentThreadId: null,
          forkSourceThreadId: "learning-parent",
        }),
        "child-1": summary({
          id: "child-1",
          parentThreadId: "learning-parent",
          forkSourceThreadId: null,
        }),
      },
    });

    expect(visible.map((target) => target.kind)).toEqual(["side", "child"]);
  });

  it("projects a selected passage as a clickable marker", () => {
    const target = {
      link: link("side-1", "attention"),
      kind: "side" as const,
      title: "Why attention?",
    };

    const markers = buildKnowledgeLinkMarkers({
      cardKey: "attention\n1",
      cardBody: "Explain attention clearly.",
      links: [target],
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.marker.selectedText).toBe("attention");
    expect(markers[0]?.target).toBe(target);

    const moved = buildKnowledgeLinkMarkers({
      cardKey: "attention\n1",
      cardBody: "First, explain attention clearly.",
      links: [target],
    });
    expect(moved[0]?.marker.selectedText).toBe("attention");
    expect(moved[0]?.marker.startOffset).toBeGreaterThan(8);
  });
});
