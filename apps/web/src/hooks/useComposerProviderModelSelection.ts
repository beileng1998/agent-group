// FILE: useComposerProviderModelSelection.ts
// Purpose: Commit the next-turn provider/model selection locally and to the server.
// Layer: Web composer controller

import {
  type ModelSelection,
  type ModelSlug,
  type ProviderKind,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback } from "react";

import { resolveAppModelSelection } from "../appSettings";
import { resolveCommittedProviderModel } from "../components/ChatView.environmentModel";
import { toastManager } from "../components/ui/toast";
import type { ComposerDraftStoreState } from "../composerDraftStore";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { ProviderModelOption } from "../providerModelOptions";

export function useComposerProviderModelSelection(input: {
  activeThreadId: ThreadId | null;
  serverModelSelection: ModelSelection | null;
  customModelsByProvider: Record<ProviderKind, readonly string[]>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  persistSelection: ComposerDraftStoreState["setModelSelectionAndSticky"];
  persistProviderOptions: ComposerDraftStoreState["setProviderModelOptions"];
  focus: () => void;
}) {
  const {
    activeThreadId,
    customModelsByProvider,
    focus,
    modelOptionsByProvider,
    persistProviderOptions,
    persistSelection,
    serverModelSelection,
  } = input;
  return useCallback(
    (provider: ProviderKind, model: ModelSlug) => {
      if (!activeThreadId) return;
      const resolvedModel = resolveCommittedProviderModel({
        selectedModel: model,
        availableOptions: modelOptionsByProvider[provider],
        fallback: () => resolveAppModelSelection(provider, customModelsByProvider, model),
      });
      const nextModelSelection: ModelSelection = { provider, model: resolvedModel };
      persistSelection(activeThreadId, nextModelSelection);

      const serverSelection = serverModelSelection;
      if (
        serverSelection &&
        (serverSelection.provider !== nextModelSelection.provider ||
          serverSelection.model !== nextModelSelection.model ||
          JSON.stringify(serverSelection.options ?? null) !==
            JSON.stringify(nextModelSelection.options ?? null))
      ) {
        const api = readNativeApi();
        if (api) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: activeThreadId,
              modelSelection: nextModelSelection,
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Could not change the next-turn agent",
                description: error instanceof Error ? error.message : "The agent was not changed.",
              });
            });
        }
      }
      if (provider === "cursor") {
        persistProviderOptions(activeThreadId, provider, undefined, {
          persistSticky: true,
          model: resolvedModel,
        });
      }
      focus();
    },
    [
      activeThreadId,
      customModelsByProvider,
      focus,
      modelOptionsByProvider,
      persistProviderOptions,
      persistSelection,
      serverModelSelection,
    ],
  );
}
