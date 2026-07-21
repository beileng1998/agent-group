import { describe, expect, it } from "vitest";

import { buildSidechatInitialMessage } from "./sidechatCreation";

describe("buildSidechatInitialMessage", () => {
  it("combines an explicit question and transcript selection into the first Side turn", () => {
    const prompt = "How does this apply to the current design?";
    const message = buildSidechatInitialMessage({
      prompt,
      selection: {
        assistantMessageId: "message-source",
        text: "The XOR example",
      },
    });

    expect(message).toEqual({
      text: [
        prompt,
        "",
        "<assistant_selection>",
        "- assistant message message-source:",
        "  The XOR example",
        "</assistant_selection>",
      ].join("\n"),
      attachments: [
        {
          type: "assistant-selection",
          assistantMessageId: "message-source",
          text: "The XOR example",
        },
      ],
    });
  });

  it("keeps a selection as a draft until the user asks a question", () => {
    expect(
      buildSidechatInitialMessage({
        prompt: "",
        selection: {
          assistantMessageId: "message-source",
          text: "The XOR example",
        },
      }),
    ).toBeNull();
  });
});
