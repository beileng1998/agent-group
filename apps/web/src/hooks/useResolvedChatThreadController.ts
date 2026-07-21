// FILE: useResolvedChatThreadController.ts
// Purpose: Resolve server and draft chat identity and route thread-local errors.
// Layer: Web chat thread controller

import { DEFAULT_MODEL_BY_PROVIDER, type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isTemporarySidechatThread } from "../agentGroupCapabilities";
import { useComposerDraftStore } from "../composerDraftStore";
import { buildLocalDraftThread } from "../components/ChatView.threadPresentation";
import { retainThreadDetailSubscription } from "../threadDetailSubscriptionRetention";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { createProjectSelector, createThreadSelector } from "../storeSelectors";

export function useResolvedChatThreadController(threadId: ThreadId) {
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const serverThread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const fallbackProject = useStore(
    useMemo(() => createProjectSelector(draftThread?.projectId ?? null), [draftThread?.projectId]),
  );
  const setStoreThreadError = useStore((store) => store.setError);
  const [localErrorsByThreadId, setLocalErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({});
  const localDraftError = serverThread ? null : (localErrorsByThreadId[threadId] ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackProject?.defaultModelSelection ?? {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackProject?.defaultModelSelection, localDraftError, threadId],
  );
  const activeThread = serverThread ?? localDraftThread;
  const isTemporarySidechat = Boolean(activeThread && isTemporarySidechatThread(activeThread));

  useEffect(() => {
    if (!isTemporarySidechat) return;
    // Embedded dock sidechats are absent from the route/split visibility router.
    return retainThreadDetailSubscription(threadId);
  }, [isTemporarySidechat, threadId]);

  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      if (getThreadFromState(useStore.getState(), targetThreadId)) {
        setStoreThreadError(targetThreadId, error);
        return;
      }
      setLocalErrorsByThreadId((existing) => {
        if ((existing[targetThreadId] ?? null) === error) return existing;
        return { ...existing, [targetThreadId]: error };
      });
    },
    [setStoreThreadError],
  );

  const isServerThread = serverThread !== undefined;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  return {
    activeThread,
    activeThreadId: activeThread?.id ?? null,
    draftThread,
    isLocalDraftThread,
    isServerThread,
    isTemporarySidechat,
    serverThread,
    setThreadError,
  };
}
