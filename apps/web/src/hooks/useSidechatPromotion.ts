// Owns the temporary Side -> durable child-session transition.

import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState } from "react";

import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { toastManager } from "../components/ui/toast";

export function useSidechatPromotion(input: {
  threadId: ThreadId | null;
  enabled: boolean;
  blocked: boolean;
  onPromoted: (threadId: ThreadId) => Promise<void> | void;
}) {
  const { threadId, enabled, blocked, onPromoted } = input;
  const [busy, setBusy] = useState(false);
  const disabled = busy || blocked;

  useEffect(() => setBusy(false), [threadId]);

  const promote = useCallback(async () => {
    if (!threadId || !enabled || disabled) return;
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "warning",
        title: "Side is unavailable",
        description: "The Agent Group service is unavailable.",
      });
      return;
    }

    setBusy(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.sidechat.promote",
        commandId: newCommandId(),
        threadId,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not keep Side",
        description: error instanceof Error ? error.message : "The sidechat could not be saved.",
      });
      setBusy(false);
      return;
    }

    const snapshot = await api.orchestration.getShellSnapshot().catch(() => null);
    if (snapshot) {
      useStore.getState().syncServerShellSnapshot(snapshot);
    }
    setBusy(false);
    toastManager.add({ type: "success", title: "Side kept as a child session" });
    try {
      await onPromoted(threadId);
    } catch (error) {
      toastManager.add({
        type: "warning",
        title: "Side was kept, but could not be opened",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [disabled, enabled, onPromoted, threadId]);

  return { busy, disabled, promote };
}
