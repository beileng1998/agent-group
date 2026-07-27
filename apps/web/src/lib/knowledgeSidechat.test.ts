import { ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import {
  buildKnowledgeSourceImportedMessage,
  findKnowledgeSidechatSource,
  findOriginalSideQuestion,
  makeLearningOrigin,
  parseKnowledgeSourceMessage,
} from "./knowledgeSidechat";

describe("Knowledge Side source", () => {
  it("round-trips an immutable Unicode card snapshot", () => {
    const source = makeLearningOrigin({
      sourceSessionId: ThreadId.makeUnsafe("parent"),
      sourceContextRevision: "revision-1",
      cardKey: "异或\n1",
      cardTitle: "异或直觉",
      cardMarkdown: "## 异或直觉\n\n输入不同时为真。<!-- -->",
      selectedText: "输入不同时为真。",
      selectionStartOffset: 0,
      selectionEndOffset: 9,
    });
    const message = buildKnowledgeSourceImportedMessage(source, "2026-07-26T00:00:00.000Z");

    expect(parseKnowledgeSourceMessage(message.text)).toEqual(source);
    expect(message.text).toContain("Selected passage:");
    expect(message.text).toContain("> 输入不同时为真。");
    expect(message.text.match(/## 异或直觉/g)).toHaveLength(1);
  });

  it("finds the source and preserves the first native Side question", () => {
    const source = makeLearningOrigin({
      sourceSessionId: ThreadId.makeUnsafe("parent"),
      sourceContextRevision: "revision-1",
      cardKey: "xor\n1",
      cardTitle: "XOR",
      cardMarkdown: "## XOR\n\nInputs differ.",
    });
    const imported = buildKnowledgeSourceImportedMessage(
      source,
      "2026-07-26T00:00:00.000Z",
    );
    const messages = [
      { ...imported, source: "fork-import" as const },
      {
        role: "user" as const,
        source: "native" as const,
        text: "Why is that?",
      },
      {
        role: "user" as const,
        source: "native" as const,
        text: "Show another example.",
      },
    ];

    expect(findKnowledgeSidechatSource(messages)).toEqual(source);
    expect(findOriginalSideQuestion(messages)).toBe("Why is that?");
  });
});
