// Owns the temporary Side -> durable child-session transition.

import type { ThreadId } from "@agent-group/contracts";
import { buildPromotedLearningContext } from "@agent-group/shared/learningContext";
import { useCallback, useEffect, useState } from "react";

import {
  findKnowledgeSidechatSource,
  findOriginalSideQuestion,
} from "../lib/knowledgeSidechat";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { toastManager } from "../components/ui/toast";
import { getThreadFromState } from "../threadDerivation";

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
    const sidechat = getThreadFromState(useStore.getState(), threadId);
    const learningSource = sidechat ? findKnowledgeSidechatSource(sidechat.messages) : null;
    const originalQuestion = sidechat ? findOriginalSideQuestion(sidechat.messages) : null;
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
    let learningInitializationError: unknown = null;
    if (learningSource && originalQuestion !== null) {
      try {
        const created = await api.agentGroup.getSession({ sessionId: threadId });
        const withOrigin = await api.agentGroup.updateSession({
          sessionId: threadId,
          learningOrigin: learningSource,
          expectedRevision: created.config.revision,
        });
        await api.agentGroup.writeContext({
          sessionId: threadId,
          context: buildPromotedLearningContext({
            goal: originalQuestion,
            sourceTitle: learningSource.cardTitle,
          }),
          expectedRevision: withOrigin.contextRevision,
        });
      } catch (error) {
        learningInitializationError = error;
      }
    }
    setBusy(false);
    if (learningInitializationError) {
      toastManager.add({
        type: "warning",
        title: "Side was kept, but Learning context could not be initialized",
        description:
          learningInitializationError instanceof Error
            ? learningInitializationError.message
            : undefined,
      });
    } else {
      toastManager.add({ type: "success", title: "Side kept as a child session" });
    }
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
