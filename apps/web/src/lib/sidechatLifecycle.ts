// Deletes a temporary sidechat after its dock pane is explicitly discarded.

import type { NativeApi, ThreadId } from "@agent-group/contracts";

import { reconcileDeletedThreadFromClient } from "./deletedThreadClientReconciliation";
import { newCommandId } from "./utils";

export async function discardTemporarySidechat(input: {
  api: NativeApi;
  threadId: ThreadId;
  clearDraft: (threadId: ThreadId) => void;
  removeDeletedThreadFromClientState: (threadId: ThreadId) => void;
}): Promise<void> {
  await input.api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId: input.threadId,
  });
  input.clearDraft(input.threadId);
  await reconcileDeletedThreadFromClient({
    threadId: input.threadId,
    removeDeletedThreadFromClientState: input.removeDeletedThreadFromClientState,
  });
}
