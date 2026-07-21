// FILE: settleComposerTurnExecution.ts
// Purpose: Apply failure compensation and release UI dispatch state after a send attempt.
// Layer: Web send orchestration

import { type NativeApi, type ThreadId } from "@agent-group/contracts";

import { restoreFailedComposerSend } from "./composerSendFailureRecovery";
import { newCommandId } from "./utils";

export async function settleComposerTurnExecution(input: {
  api: NativeApi;
  threadId: ThreadId;
  failure: { readonly error: unknown } | null;
  turnStartSucceeded: boolean;
  createdServerThreadForLocalDraft: boolean;
  shouldRestoreComposer: boolean;
  restore: Parameters<typeof restoreFailedComposerSend>[0];
  hasWorktreeSetup: boolean;
  failWorktreeSetup: () => void;
  releaseSend: () => void;
  resetLocalDispatch: () => void;
  scheduleFailedWorktreeSetupDispatchReset: () => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}): Promise<boolean> {
  if (input.failure) {
    input.failWorktreeSetup();
    if (input.createdServerThreadForLocalDraft && !input.turnStartSucceeded) {
      // This rollback cleans up a retryable draft promotion; do not tombstone the draft id.
      await input.api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: input.threadId,
        })
        .catch(() => undefined);
    }
    if (input.shouldRestoreComposer && !input.turnStartSucceeded) {
      restoreFailedComposerSend(input.restore);
    }
    input.setThreadError(
      input.threadId,
      input.failure.error instanceof Error
        ? input.failure.error.message
        : "Failed to send message.",
    );
  }

  input.releaseSend();
  if (!input.turnStartSucceeded) {
    if (input.hasWorktreeSetup) {
      input.scheduleFailedWorktreeSetupDispatchReset();
    } else {
      input.resetLocalDispatch();
    }
  }
  return input.turnStartSucceeded;
}
