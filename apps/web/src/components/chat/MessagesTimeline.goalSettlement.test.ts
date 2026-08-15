import { GOAL_ACHIEVED_MARKER } from "@agent-group/shared/goalSettlement";
import { describe, expect, it } from "vitest";

import {
  resolveAssistantMessageCopyState,
  resolveAssistantMessageDisplayText,
} from "./MessagesTimeline.messagePresentation";

describe("goal settlement message presentation", () => {
  it("keeps the internal marker out of display and copy text", () => {
    const text = `Verified complete.\n${GOAL_ACHIEVED_MARKER}`;
    expect(
      resolveAssistantMessageDisplayText({ message: { text, streaming: false } }),
    ).toBe("Verified complete.");
    expect(
      resolveAssistantMessageCopyState({ text, showCopyButton: true, streaming: false }),
    ).toEqual({ text: "Verified complete.", visible: true });
  });
});
