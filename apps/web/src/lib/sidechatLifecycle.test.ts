import { ThreadId, type NativeApi } from "@agent-group/contracts";
import { describe, expect, it, vi } from "vitest";

import { discardTemporarySidechat } from "./sidechatLifecycle";

describe("discardTemporarySidechat", () => {
  it("deletes the server thread before clearing its local state", async () => {
    const threadId = ThreadId.makeUnsafe("thread-sidechat");
    const dispatchCommand = vi.fn(async () => undefined);
    const clearDraft = vi.fn();
    const removeDeletedThreadFromClientState = vi.fn();

    await discardTemporarySidechat({
      api: { orchestration: { dispatchCommand } } as unknown as NativeApi,
      threadId,
      clearDraft,
      removeDeletedThreadFromClientState,
    });

    expect(dispatchCommand).toHaveBeenCalledWith({
      type: "thread.delete",
      commandId: expect.any(String),
      threadId,
    });
    expect(clearDraft).toHaveBeenCalledWith(threadId);
    expect(removeDeletedThreadFromClientState).toHaveBeenCalledWith(threadId);
    expect(dispatchCommand.mock.invocationCallOrder[0]).toBeLessThan(
      clearDraft.mock.invocationCallOrder[0]!,
    );
  });
});
