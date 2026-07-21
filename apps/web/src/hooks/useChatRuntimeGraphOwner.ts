// FILE: useChatRuntimeGraphOwner.ts
// Purpose: Compose session/workspace, runtime activity, and composer reference state.
// Layer: Web chat composition root

import { ThreadId } from "@agent-group/contracts";
import { useCallback } from "react";

import type { ChatViewProps } from "../components/chat/ChatView.types";
import { useFeatureFlags } from "../featureFlags";
import type { ChatViewFoundationOwner } from "./useChatViewFoundationOwner";
import { useChatRuntimeActivityOwner } from "./useChatRuntimeActivityOwner";
import { useChatSessionWorkspaceOwner } from "./useChatSessionWorkspaceOwner";
import { useComposerReferenceSelectionController } from "./useComposerReferenceSelectionController";

export interface ChatRuntimeGraphOwnerInput {
  readonly foundation: ChatViewFoundationOwner;
  readonly panels: {
    readonly state: ChatViewProps["panelState"];
    readonly onToggleDiff: ChatViewProps["onToggleDiffPanel"];
    readonly onToggleBrowser: ChatViewProps["onToggleBrowserPanel"];
    readonly onOpenBrowserUrl: ChatViewProps["onOpenBrowserUrl"];
  };
  readonly onSidechatPromoted: ChatViewProps["onSidechatPromoted"];
}

export function useChatRuntimeGraphOwner(input: ChatRuntimeGraphOwnerInput) {
  const { app, composer, identity, overlays, store, thread } = input.foundation;
  const { draft } = composer;
  const { content, actions } = draft;
  const sessionWorkspace = useChatSessionWorkspaceOwner({
    route: {
      threadId: identity.threadId,
      splitViewId: app.rawSearch.splitViewId ?? null,
      panel: app.rawSearch.panel,
      navigate: app.navigate,
    },
    thread: {
      active: thread.activeThread,
      draft: thread.draftThread,
      isLocalDraft: thread.isLocalDraftThread,
      isServer: thread.isServerThread,
    },
    composer: {
      draft: draft.draft,
      prompt: content.prompt,
      modelPickerOpen: composer.picker.modelOpen,
    },
    presentation: {
      focusedPane: app.shell.isFocusedPane,
      dismissedRateLimitBannerKey: overlays.dismissedRateLimitBannerKey,
    },
    panels: {
      external: input.panels.state?.panel,
      onToggleDiff: input.panels.onToggleDiff,
      onToggleBrowser: input.panels.onToggleBrowser,
      onOpenBrowserUrl: input.panels.onOpenBrowserUrl,
    },
    provider: { settings: app.settings },
    actions: { setComposerHighlightedItemId: composer.commandState.setHighlightedItemId },
  });
  const references = useComposerReferenceSelectionController({
    threadId: identity.threadId,
    prompt: content.prompt,
    provider: sessionWorkspace.provider.selectedProvider,
    persistedSkills: content.skills,
    persistedMentions: content.mentions,
    persistSkills: actions.setSkills,
    persistMentions: actions.setMentions,
  });
  const finishSidechatPromotion = useCallback(
    async (promotedThreadId: ThreadId) => {
      if (input.onSidechatPromoted) {
        await input.onSidechatPromoted(promotedThreadId);
        return;
      }
      await app.navigate({
        to: "/$threadId",
        params: { threadId: promotedThreadId },
      });
    },
    [app.navigate, input.onSidechatPromoted],
  );
  const featureFlags = useFeatureFlags();
  const runtimeActivity = useChatRuntimeActivityOwner({
    thread: {
      id: identity.threadId,
      activeId: thread.activeThreadId,
      active: thread.activeThread,
      latestTurn: sessionWorkspace.runtime.latestTurn,
      activities: sessionWorkspace.runtime.activities,
      latestTurnSettled: sessionWorkspace.runtime.settled,
      latestTurnLive: sessionWorkspace.runtime.live,
      hasLiveTurnTail: sessionWorkspace.runtime.hasLiveTail,
      serverMessages: thread.activeThread?.messages,
      promptHistoryMessages: thread.serverThread?.messages,
      hasSidechatSource: Boolean(thread.activeThread?.sidechatSourceThreadId),
      isTemporarySidechat: thread.isTemporarySidechat,
      showDebugTaskBanner: import.meta.env.DEV && featureFlags["show-debug-task-banner"],
      setPendingError: store.setStoreThreadError,
      setError: thread.setThreadError,
    },
    composer: {
      pending: {
        promptRef: composer.promptRef,
        setComposerCursor: composer.commandState.setCursor,
        setComposerHighlightedItemId: composer.commandState.setHighlightedItemId,
        setComposerTrigger: composer.commandState.setTrigger,
        setPrompt: composer.setPrompt,
        setRuntimeMode: actions.setRuntimeMode,
      },
      promptHistory: {
        prompt: content.prompt,
        composerDraft: draft.draft,
        savedDraft: content.promptHistorySavedDraft,
        promptRef: composer.promptRef,
        setPrompt: composer.setPrompt,
        setComposerCursor: composer.commandState.setCursor,
        setComposerTrigger: composer.commandState.setTrigger,
        setSavedDraft: actions.setPromptHistorySavedDraft,
        restoreSavedDraft: actions.restorePromptHistorySavedDraft,
      },
      setDraftPrompt: actions.setPrompt,
    },
    provider: {
      runtimeMode: sessionWorkspace.runtime.runtimeMode,
      setRuntimeMode: actions.setRuntimeMode,
    },
    settings: { interactionMode: sessionWorkspace.runtime.interactionMode },
    navigation: { finishSidechatPromotion },
  });

  return { sessionWorkspace, runtimeActivity, references };
}

export type ChatRuntimeGraphOwner = ReturnType<typeof useChatRuntimeGraphOwner>;
