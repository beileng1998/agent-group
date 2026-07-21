import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, ThreadId } from "@agent-group/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { useComposerFocusRequestStore } from "../composerFocusRequestStore";
import { addAssistantSelectionToComposer } from "./assistantSelectionComposerTarget";

describe("addAssistantSelectionToComposer", () => {
  afterEach(() => {
    useComposerDraftStore.setState({ draftsByThreadId: {} });
    useComposerFocusRequestStore.setState({ requestsByThreadId: {} });
  });

  it("adds the reference to the requested Side composer and focuses it", () => {
    const threadId = ThreadId.makeUnsafe("sidechat-target");

    expect(
      addAssistantSelectionToComposer(threadId, {
        assistantMessageId: "source-message",
        text: "Selected explanation",
      }),
    ).toBe("inserted");
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.assistantSelections,
    ).toEqual([
      expect.objectContaining({
        assistantMessageId: "source-message",
        text: "Selected explanation",
      }),
    ]);
    expect(useComposerFocusRequestStore.getState().requestsByThreadId[threadId]).toBe(1);
  });

  it("does not exceed the provider attachment limit", () => {
    const threadId = ThreadId.makeUnsafe("full-sidechat-target");
    const store = useComposerDraftStore.getState();
    for (let index = 0; index < PROVIDER_SEND_TURN_MAX_ATTACHMENTS; index += 1) {
      store.addAssistantSelection(threadId, {
        type: "assistant-selection",
        id: `selection-${index}`,
        assistantMessageId: `message-${index}`,
        text: `selection ${index}`,
      });
    }

    expect(
      addAssistantSelectionToComposer(threadId, {
        assistantMessageId: "one-more-message",
        text: "one more selection",
      }),
    ).toBe("limit");
  });
});
