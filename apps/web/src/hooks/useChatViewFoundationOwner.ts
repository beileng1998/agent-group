// FILE: useChatViewFoundationOwner.ts
// Purpose: Own route, draft, thread identity, and local shell state for ChatView.
// Layer: Web chat composition root

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { resolveAssistantDeliveryMode, useAppSettings } from "../appSettings";
import type { ChatViewProps } from "../components/chat/ChatView.types";
import { useChatComposerDraftController } from "./useChatComposerDraftController";
import { useComposerPickerOpenController } from "./useComposerPickerOpenController";
import { useChatComposerCommandState } from "./useChatComposerCommandOwner";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "./useDesktopTopBarGutter";
import { useDiffRouteSearch } from "./useDiffRouteSearch";
import { useExpandedImageController } from "./useExpandedImageController";
import { useHandleNewThread } from "./useHandleNewThread";
import { useResolvedChatThreadController } from "./useResolvedChatThreadController";
import { useRestoredQueuedDraftSourceController } from "./useRestoredQueuedDraftSourceController";
import { useTheme } from "./useTheme";
import { gitCreateWorktreeMutationOptions } from "../lib/gitReactQuery";
import { useStore } from "../store";
import { useTemporaryThreadStore } from "../temporaryThreadStore";

export interface ChatViewFoundationOwnerInput {
  readonly threadId: ChatViewProps["threadId"];
  readonly surfaceMode: NonNullable<ChatViewProps["surfaceMode"]>;
  readonly presentationMode: NonNullable<ChatViewProps["presentationMode"]>;
  readonly isFocusedPane: boolean;
}

export function useChatViewFoundationOwner(input: ChatViewFoundationOwnerInput) {
  const { threadId } = input;
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const setStoreThreadError = useStore((store) => store.setError);
  const setStoreThreadWorkspace = useStore((store) => store.setThreadWorkspace);
  const { settings, updateSettings } = useAppSettings();
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const rawSearch = useDiffRouteSearch();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));
  const draft = useChatComposerDraftController(threadId);
  const thread = useResolvedChatThreadController(threadId);
  const prompt = draft.content.prompt;
  const promptRef = useRef(prompt);
  const setPrompt = useCallback(
    (nextPrompt: string) => draft.actions.setPrompt(threadId, nextPrompt),
    [draft.actions.setPrompt, threadId],
  );

  const hasTemporaryThreadMarker = useTemporaryThreadStore((store) =>
    threadId ? store.temporaryThreadIds[threadId] === true : false,
  );
  const markTemporaryThread = useTemporaryThreadStore((store) => store.markTemporaryThread);
  const clearTemporaryThread = useTemporaryThreadStore((store) => store.clearTemporaryThread);
  const expandedImage = useExpandedImageController(threadId);
  const [dismissedRateLimitBannerKey, setDismissedRateLimitBannerKey] = useState<string | null>(
    null,
  );
  const sendInFlightRef = useRef(false);
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const picker = useComposerPickerOpenController();
  const commandState = useChatComposerCommandState({
    threadId,
    prompt,
    closeAuxiliaryPickers: picker.closeAll,
  });
  const restoredQueue = useRestoredQueuedDraftSourceController({
    threadId,
    source: draft.content.restoredSourceProposedPlan,
    persist: draft.actions.setRestoredSourceProposedPlan,
  });

  return {
    identity: { threadId },
    app: {
      settings,
      updateSettings,
      assistantDeliveryMode: resolveAssistantDeliveryMode(settings),
      timestampFormat: settings.timestampFormat,
      resolvedTheme,
      navigate,
      handleNewThread,
      rawSearch,
      createWorktreeMutation,
      shell: {
        surfaceMode: input.surfaceMode,
        presentationMode: input.presentationMode,
        isFocusedPane: input.isFocusedPane,
        isEditorRail: input.presentationMode === "editor",
        isInactiveSplitPane: input.surfaceMode === "split" && !input.isFocusedPane,
        desktopTopBarTrafficLightGutterClassName,
        desktopTopBarWindowControlsGutterClassName,
      },
    },
    store: {
      syncServerShellSnapshot,
      setStoreThreadError,
      setStoreThreadWorkspace,
    },
    thread: {
      ...thread,
      temporary: {
        hasMarker: hasTemporaryThreadMarker,
        mark: () => markTemporaryThread(threadId),
        clear: () => clearTemporaryThread(threadId),
      },
    },
    composer: {
      draft,
      promptRef,
      setPrompt,
      picker,
      commandState,
      restoredQueue,
      sendInFlightRef,
    },
    overlays: {
      expandedImage,
      dismissedRateLimitBannerKey,
      setDismissedRateLimitBannerKey,
    },
  };
}

export type ChatViewFoundationOwner = ReturnType<typeof useChatViewFoundationOwner>;
