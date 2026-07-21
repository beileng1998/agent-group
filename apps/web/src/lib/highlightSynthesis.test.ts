import {
  MessageId,
  ProjectId,
  ThreadId,
  ThreadMarkerId,
  type HighlightListItem,
} from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { buildHighlightSynthesisMessage } from "./highlightSynthesis";

const item = (id: string, note: string | null = null): HighlightListItem => ({
  kind: "highlight",
  marker: {
    id: ThreadMarkerId.makeUnsafe(id),
    messageId: MessageId.makeUnsafe(`message-${id}`),
    startOffset: 0,
    endOffset: 5,
    selectedText: `quote ${id}`,
    prefix: "",
    suffix: "",
    style: "highlight",
    color: "yellow",
    note,
    label: null,
    done: false,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  },
  group: { id: ProjectId.makeUnsafe("group-1"), title: "Research" },
  session: {
    id: ThreadId.makeUnsafe("session-1"),
    title: "Reading",
    parentSessionId: null,
    archivedAt: null,
  },
  message: {
    id: MessageId.makeUnsafe(`message-${id}`),
    role: "assistant",
    createdAt: "2026-07-18T00:00:00.000Z",
    exists: true,
  },
});

describe("buildHighlightSynthesisMessage", () => {
  it("freezes ordered sources with stable H references and notes", () => {
    const message = buildHighlightSynthesisMessage("Write a note.", [
      item("one", "My note"),
      item("two"),
    ]);
    expect(message).toContain("### [H1] Research › Reading");
    expect(message).toContain("> quote one");
    expect(message).toContain("Note:\nMy note");
    expect(message).toContain("### [H2] Research › Reading");
  });

  it("includes whole pinned messages and their labels", () => {
    const pinned: HighlightListItem = {
      kind: "pin",
      pin: {
        messageId: MessageId.makeUnsafe("message-pin"),
        label: "Keep this conclusion",
        done: false,
        pinnedAt: "2026-07-18T00:00:00.000Z",
      },
      group: { id: ProjectId.makeUnsafe("group-1"), title: "Research" },
      session: {
        id: ThreadId.makeUnsafe("session-1"),
        title: "Reading",
        parentSessionId: null,
        archivedAt: null,
      },
      message: {
        id: MessageId.makeUnsafe("message-pin"),
        role: "assistant",
        createdAt: "2026-07-18T00:00:00.000Z",
        exists: true,
        text: "Pinned answer",
      },
    };

    const message = buildHighlightSynthesisMessage("Write a note.", [pinned]);
    expect(message).toContain("> Pinned answer");
    expect(message).toContain("Note:\nKeep this conclusion");
  });
});
