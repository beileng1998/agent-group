// FILE: useThreadModeController.ts
// Purpose: Own thread runtime/interaction mode updates and next-turn persistence.
// Layer: Web thread controller

import {
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { Thread } from "../types";

interface ThreadModeControllerInput {
  readonly threadId: ThreadId;
  readonly serverThread: Thread | undefined;
  readonly isServerThread: boolean;
  readonly isLocalDraftThread: boolean;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly setDraftRuntimeMode: (threadId: ThreadId, mode: RuntimeMode) => void;
  readonly setDraftInteractionMode: (threadId: ThreadId, mode: ProviderInteractionMode) => void;
  readonly setDraftThreadContext: (
    threadId: ThreadId,
    context: {
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  readonly focusComposer: () => void;
}

export function useThreadModeController(input: ThreadModeControllerInput) {
  const {
    threadId,
    serverThread,
    isServerThread,
    isLocalDraftThread,
    runtimeMode,
    interactionMode,
    setDraftRuntimeMode,
    setDraftInteractionMode,
    setDraftThreadContext,
    focusComposer,
  } = input;
  const stopSession = useCallback(async () => {
    const api = readNativeApi();
    if (
      !api ||
      !isServerThread ||
      !serverThread ||
      serverThread.session === null ||
      serverThread.session.status === "closed"
    ) {
      return;
    }
    await api.orchestration.dispatchCommand({
      type: "thread.session.stop",
      commandId: newCommandId(),
      threadId: serverThread.id,
      createdAt: new Date().toISOString(),
    });
  }, [isServerThread, serverThread]);

  const changeRuntimeMode = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setDraftRuntimeMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { runtimeMode: mode });
      }
      if (serverThread) {
        const api = readNativeApi();
        if (api) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.runtime-mode.set",
              commandId: newCommandId(),
              threadId,
              runtimeMode: mode,
              createdAt: new Date().toISOString(),
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Could not update access mode",
                description:
                  error instanceof Error ? error.message : "An unexpected error occurred.",
              });
            });
        }
      }
      focusComposer();
    },
    [
      focusComposer,
      isLocalDraftThread,
      runtimeMode,
      serverThread,
      setDraftRuntimeMode,
      setDraftThreadContext,
      threadId,
    ],
  );

  const changeInteractionMode = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setDraftInteractionMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { interactionMode: mode });
      }
      if (serverThread) {
        const api = readNativeApi();
        if (api) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.interaction-mode.set",
              commandId: newCommandId(),
              threadId,
              interactionMode: mode,
              createdAt: new Date().toISOString(),
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Could not update plan mode",
                description:
                  error instanceof Error ? error.message : "An unexpected error occurred.",
              });
            });
        }
      }
      focusComposer();
    },
    [
      focusComposer,
      interactionMode,
      isLocalDraftThread,
      serverThread,
      setDraftInteractionMode,
      setDraftThreadContext,
      threadId,
    ],
  );

  const toggleInteractionMode = useCallback(() => {
    changeInteractionMode(interactionMode === "plan" ? "default" : "plan");
  }, [changeInteractionMode, interactionMode]);

  const setPlanMode = useCallback(
    (enabled: boolean) => changeInteractionMode(enabled ? "plan" : "default"),
    [changeInteractionMode],
  );

  const persistForNextTurn = useCallback(
    async (next: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverThread) return;
      const api = readNativeApi();
      if (!api) return;

      if (
        next.modelSelection !== undefined &&
        (next.modelSelection.model !== serverThread.modelSelection.model ||
          next.modelSelection.provider !== serverThread.modelSelection.provider ||
          JSON.stringify(next.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: next.threadId,
          modelSelection: next.modelSelection,
        });
      }
      if (next.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: next.threadId,
          runtimeMode: next.runtimeMode,
          createdAt: next.createdAt,
        });
      }
      if (next.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: next.threadId,
          interactionMode: next.interactionMode,
          createdAt: next.createdAt,
        });
      }
    },
    [serverThread],
  );

  return {
    changeInteractionMode,
    changeRuntimeMode,
    persistForNextTurn,
    setPlanMode,
    stopSession,
    toggleInteractionMode,
  };
}
