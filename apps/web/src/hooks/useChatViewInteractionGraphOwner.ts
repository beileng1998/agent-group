// FILE: useChatViewInteractionGraphOwner.ts
// Purpose: Compose editor, workspace, timeline, model, and shortcut controllers in dependency order.
// Layer: Web chat composition root

import { useMemo } from "react";

import { AGENT_GROUP_CAPABILITIES } from "../agentGroupCapabilities";
import {
  EMPTY_PINNED_MESSAGES,
  EMPTY_THREAD_MARKERS,
  VOICE_RECORDER_ACTION_ARM_DELAY_MS,
} from "../components/chat/chatViewComposerValues";
import {
  EMPTY_AVAILABLE_EDITORS,
  EMPTY_KEYBINDINGS,
} from "../components/chat/chatViewProviderValues";
import { shouldRenderProviderHealthBanner } from "../components/ChatView.logic";
import type { ChatViewProps } from "../components/chat/ChatView.types";
import { useChatComposerControlsOwner } from "./useChatComposerControlsOwner";
import { useChatComposerInteractionOwner } from "./useChatComposerInteractionOwner";
import type { ChatRuntimeGraphOwner } from "./useChatRuntimeGraphOwner";
import { useChatShortcutLabels } from "./useChatShortcutLabels";
import { useChatThreadHeaderController } from "./useChatThreadHeaderController";
import { useChatTimelineOwner } from "./useChatTimelineOwner";
import type { ChatViewFoundationOwner } from "./useChatViewFoundationOwner";
import { useChatWorkspaceActionsOwner } from "./useChatWorkspaceActionsOwner";
import { useChatWorkspaceShortcutsOwner } from "./useChatWorkspaceShortcutsOwner";
import { useDeferredSecondaryChrome } from "./useDeferredSecondaryChrome";

export interface ChatViewInteractionGraphOwnerInput {
  readonly foundation: ChatViewFoundationOwner;
  readonly runtimeGraph: ChatRuntimeGraphOwner;
  readonly route: {
    readonly onOpenTurnDiffPanel: ChatViewProps["onOpenTurnDiffPanel"];
    readonly onOpenHighlightsPanel: ChatViewProps["onOpenHighlightsPanel"];
  };
}

export function useChatViewInteractionGraphOwner(input: ChatViewInteractionGraphOwnerInput) {
  const { foundation, runtimeGraph } = input;
  const { app, composer, identity, overlays, store, thread } = foundation;
  const { draft } = composer;
  const { sessionWorkspace, runtimeActivity } = runtimeGraph;
  const { content, actions: draftActions, attachmentState } = draft;
  const { terminalState } = sessionWorkspace.terminal;
  const timelineEntries = runtimeActivity.transcript.timelineEntries;
  const pinnedMessages = thread.activeThread?.pinnedMessages ?? EMPTY_PINNED_MESSAGES;
  const threadMarkers = thread.activeThread?.threadMarkers ?? EMPTY_THREAD_MARKERS;
  const threadNotes = thread.activeThread?.notes ?? "";
  const isCenteredEmptyLanding =
    timelineEntries.length === 0 && !thread.activeThread?.parentThreadId && !app.shell.isEditorRail;
  const isEmptyChatLanding =
    isCenteredEmptyLanding &&
    Boolean(sessionWorkspace.project.homeDir) &&
    sessionWorkspace.workspace.container.isLanding;
  const terminalWorkspaceTerminalTabActive =
    sessionWorkspace.terminal.workspaceOpen &&
    (terminalState.workspaceLayout === "terminal-only" ||
      terminalState.workspaceActiveTab === "terminal");
  const shouldRenderChatPaneContent = !(
    terminalWorkspaceTerminalTabActive && terminalState.workspaceLayout === "terminal-only"
  );
  const shouldDeferSecondaryChrome =
    thread.activeThread !== undefined &&
    !isCenteredEmptyLanding &&
    !terminalWorkspaceTerminalTabActive;
  const secondaryChrome = useDeferredSecondaryChrome({
    activeThreadId: thread.activeThread?.id ?? null,
    routeThreadId: identity.threadId,
    defer: shouldDeferSecondaryChrome,
  });
  const keybindings =
    sessionWorkspace.provider.serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const availableEditors =
    sessionWorkspace.provider.serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;
  const shortcutLabels = useChatShortcutLabels(keybindings);

  const composerInteraction = useChatComposerInteractionOwner({
    provider: {
      availability: {
        rawStatuses: sessionWorkspace.provider.serverConfigQuery.data?.providers,
        settings: app.settings,
        activeThread: thread.activeThread,
        selectedProvider: sessionWorkspace.provider.selectedProvider,
      },
    },
    composer: {
      focus: {
        threadId: identity.threadId,
        activeThreadId: thread.activeThreadId,
        secondaryChromeThreadId: secondaryChrome.threadId,
        secondaryChromeReady: secondaryChrome.ready,
        editorDisabled: runtimeActivity.presentation.isComposerEditorDisabled,
        inactiveSplitPane: app.shell.isInactiveSplitPane,
        terminalOpen: terminalState.terminalOpen,
        terminalEntryPoint: terminalState.entryPoint,
        terminalWorkspaceOpen: sessionWorkspace.terminal.workspaceOpen,
        terminalWorkspaceActiveTab: terminalState.workspaceActiveTab,
        requestTerminalFocus: sessionWorkspace.terminal.requestFocus,
        openTerminalThreadPage: sessionWorkspace.terminal.openTerminalThreadPage,
      },
      promptMutation: {
        threadId: identity.threadId,
        promptRef: composer.promptRef,
        commandPicker: composer.commandState.commandPicker,
        terminalContexts: content.terminalContexts,
        pending: {
          requestId: runtimeActivity.pending.activePendingUserInput?.requestId ?? null,
          questionId: runtimeActivity.pending.activePendingProgress?.activeQuestion?.id ?? null,
          answersByRequestIdRef: runtimeActivity.pending.answersByRequestIdRef,
          mergeDraftAnswers: runtimeActivity.pending.mergePendingDraftAnswers,
          changeCustomAnswer: runtimeActivity.pending.changeActivePendingCustomAnswer,
          interruptHistory: runtimeActivity.promptHistory.interruptForPendingInput,
        },
        handleHistoryEditorChange: runtimeActivity.promptHistory.handleEditorChange,
        clearRestoredSourceIfPromptChanged: composer.restoredQueue.clearIfPromptChanged,
        setPrompt: composer.setPrompt,
        setCommandPicker: composer.commandState.setCommandPicker,
        persistTerminalContexts: draftActions.setTerminalContexts,
        setCursor: composer.commandState.setCursor,
        setTrigger: composer.commandState.setTrigger,
      },
      voice: {
        activeProject: sessionWorkspace.project.value,
        activeThreadId: thread.activeThreadId,
        threadId: identity.threadId,
        selectedProvider: sessionWorkspace.provider.selectedProvider,
        pendingUserInputCount: runtimeActivity.pending.pendingUserInputs.length,
        actionArmDelayMs: VOICE_RECORDER_ACTION_ARM_DELAY_MS,
        transcriptionFailureTitle: "Couldn't transcribe voice note",
      },
      references: {
        threadId: identity.threadId,
        activeThreadId: thread.activeThreadId,
        pendingUserInputCount: runtimeActivity.pending.pendingUserInputs.length,
        images: content.images,
        files: content.files,
        assistantSelections: content.assistantSelections,
        terminalContexts: content.terminalContexts,
        fileComments: content.fileComments,
        pastedTexts: content.pastedTexts,
        promptHistorySavedDraft: content.promptHistorySavedDraft,
        nonPersistedImageIds: attachmentState.nonPersistedImageIds,
        persistedAttachments: attachmentState.persistedAttachments,
        promptRef: composer.promptRef,
        composerCursor: composer.commandState.cursor,
        discardPromptHistory: runtimeActivity.promptHistory.discardForMutation,
        setPrompt: composer.setPrompt,
        setComposerCursor: composer.commandState.setCursor,
        setComposerTrigger: composer.commandState.setTrigger,
        setThreadError: thread.setThreadError,
      },
    },
  });

  const hasNativeUserMessages = useMemo(
    () =>
      thread.activeThread?.messages.some(
        (message) => message.role === "user" && message.source === "native",
      ) ?? false,
    [thread.activeThread?.messages],
  );
  const workspaceActions = useChatWorkspaceActionsOwner({
    thread: {
      routeId: identity.threadId,
      activeId: thread.activeThreadId,
      active: thread.activeThread,
      server: thread.serverThread,
      draft: thread.draftThread,
      isServer: thread.isServerThread,
      isLocalDraft: thread.isLocalDraftThread,
      hasNativeUserMessages,
    },
    workspace: {
      project: sessionWorkspace.project.value,
      activeRootBranch: sessionWorkspace.workspace.git.activeRootBranch,
      associatedWorktree: sessionWorkspace.workspace.environment.associatedWorktree,
      gitCwd: sessionWorkspace.workspace.gitCwd,
      branchSourceCwd: sessionWorkspace.workspace.git.branchSourceCwd,
      threadCwd: sessionWorkspace.workspace.git.cwd,
      runtimeEnv: sessionWorkspace.workspace.terminalRuntimeEnv,
      isHomeContainer: sessionWorkspace.workspace.container.isHome,
      isStudioContainer: sessionWorkspace.workspace.container.isStudio,
      centeredEmptyLanding: isCenteredEmptyLanding,
      surfaceMode: app.shell.surfaceMode,
      terminal: sessionWorkspace.terminal,
    },
    composer: {
      scheduleFocus: composerInteraction.focus.schedule,
      addTerminalContext: composerInteraction.references.actions.addTerminalContext,
      setDraftRuntimeMode: draftActions.setRuntimeMode,
      setDraftInteractionMode: draftActions.setInteractionMode,
      setDraftThreadContext: draftActions.setDraftThreadContext,
    },
    runtime: {
      runtimeMode: sessionWorkspace.runtime.runtimeMode,
      interactionMode: sessionWorkspace.runtime.interactionMode,
      latestTurnSettled: sessionWorkspace.runtime.settled,
      providerOptions: sessionWorkspace.provider.providerOptionsForDispatch,
      hasLiveTurn: runtimeActivity.session.hasLiveTurn,
    },
    settings: {
      environment: {
        defaultOpen: app.settings.environmentPanelDefaultOpen,
        codexHomePath: app.settings.codexHomePath,
        update: app.updateSettings,
      },
      terminalShortcuts: shortcutLabels.terminal,
    },
    actions: {
      setThreadError: thread.setThreadError,
      setStoreThreadWorkspace: store.setStoreThreadWorkspace,
      syncServerShellSnapshot: store.syncServerShellSnapshot,
    },
  });

  const timeline = useChatTimelineOwner({
    thread: {
      id: identity.threadId,
      activeId: thread.activeThreadId,
      active: thread.activeThread,
      sourceId: thread.activeThread?.sidechatSourceThreadId ?? null,
      pinnedMessages,
      markers: threadMarkers,
      notes: threadNotes,
      projectInstructions: sessionWorkspace.project.instructions,
      temporarySidechat: thread.isTemporarySidechat,
    },
    route: {
      navigate: app.navigate,
      messageThreadId: app.rawSearch.messageThreadId,
      messageId: app.rawSearch.messageId,
      highlightId: app.rawSearch.highlightId,
      editorRail: app.shell.isEditorRail,
      diffEnvironmentPending: sessionWorkspace.workspace.environment.diffPending,
      onOpenTurnDiffPanel: input.route.onOpenTurnDiffPanel,
      onOpenHighlights: input.route.onOpenHighlightsPanel,
    },
    runtime: {
      timelineMessages: runtimeActivity.transcript.timelineMessages,
      timelineEntries,
      workLogEntries: runtimeActivity.activity.rawWorkLogEntries,
      latestTurnId: sessionWorkspace.runtime.latestTurn?.turnId ?? null,
      composerStackedChromeHeight: runtimeActivity.presentation.composerStackedChromeHeight,
      inactiveSplitPane: app.shell.isInactiveSplitPane,
      pendingUserInputCount: runtimeActivity.pending.pendingUserInputs.length,
      composerApprovalState: runtimeActivity.pending.isComposerApprovalState,
    },
    workspace: {
      gitCwd: sessionWorkspace.workspace.git.cwd,
      isGitRepo: sessionWorkspace.workspace.git.isRepo,
      repoRefetchInterval:
        typeof sessionWorkspace.workspace.repoDiffBadgeRefreshIntervalMs === "number"
          ? sessionWorkspace.workspace.repoDiffBadgeRefreshIntervalMs
          : false,
      activeProjectId: sessionWorkspace.project.id,
    },
    composer: {
      imagesRef: composerInteraction.references.refs.images,
      filesRef: composerInteraction.references.refs.files,
      assistantSelectionsRef: composerInteraction.references.refs.assistantSelections,
      addAssistantSelection: composerInteraction.references.actions.addAssistantSelectionToDraft,
      scheduleFocus: composerInteraction.focus.schedule,
    },
    sidechat: {
      visibleTargetThreadId:
        workspaceActions.terminalPresentation.rightDock.visibleSidechatTargetThreadId,
      creationEnabled: AGENT_GROUP_CAPABILITIES.sidechat,
    },
    settings: { defaultMarkerColor: app.settings.defaultThreadMarkerColor },
    actions: {
      isPendingSetupBubbleId: runtimeActivity.automation.isPendingSetupBubbleId,
      newEditorThread: app.handleNewThread,
      openEditorThreadPage: sessionWorkspace.terminal.openChatThreadPage,
      revertToTurnCount: runtimeActivity.checkpoint.revertToTurnCount,
      runProjectScript: workspaceActions.projectScripts.runProjectScript,
    },
  });

  const composerControls = useChatComposerControlsOwner({
    layout: {
      activeThreadId: thread.activeThreadId,
      footerHasWideActions: runtimeActivity.presentation.composerFooterHasWideActions,
      inactive: app.shell.isInactiveSplitPane,
      isTranscriptAtEnd: timeline.scroll.isAtEnd,
      scrollTranscriptToEnd: timeline.scroll.scrollToEnd,
    },
    provider: {
      availability: composerInteraction.availability,
      selection: {
        activeThreadId: thread.activeThread?.id ?? null,
        serverModelSelection: thread.serverThread?.modelSelection ?? null,
        customModelsByProvider: sessionWorkspace.provider.catalog.customModelsByProvider,
        modelOptionsByProvider: sessionWorkspace.provider.catalog.modelOptionsByProvider,
        persistSelection: draftActions.setModelSelectionAndSticky,
        persistProviderOptions: draftActions.setProviderModelOptions,
      },
      modelControls: {
        provider: {
          selected: sessionWorkspace.provider.selectedProvider,
          selectedModel: sessionWorkspace.provider.selectedModel,
          pickerModel: sessionWorkspace.provider.selectedModelForPickerWithCustomFallback,
          locked: sessionWorkspace.provider.lockedProvider,
          modelOptionsByProvider: sessionWorkspace.provider.catalog.modelOptionsByProvider,
          loadingModelProviders: sessionWorkspace.provider.catalog.loadingModelProviders,
          order: app.settings.providerOrder,
        },
        runtime: {
          threadId: identity.threadId,
          prompt: content.prompt,
          modelOptions: sessionWorkspace.provider.selectedModelOptions,
          selectedModel: sessionWorkspace.provider.selectedRuntimeModel,
          models:
            sessionWorkspace.provider.catalog.runtimeModelsByProvider[
              sessionWorkspace.provider.selectedProvider
            ],
          agents: sessionWorkspace.provider.catalog.selectedRuntimeAgents,
          activeContextWindow: sessionWorkspace.runtime.contextWindow,
        },
        layout: {
          isLocalDraftThread: thread.isLocalDraftThread,
          hasThreadStarted: sessionWorkspace.provider.hasThreadStarted,
          showBootstrapSkeleton: sessionWorkspace.provider.showBootstrapSkeleton,
          selectedProviderRuntimeModelDiscoveryPending:
            sessionWorkspace.provider.catalog.selectedProviderRuntimeModelDiscoveryPending,
        },
        actions: {
          persistProviderOptions: draftActions.setProviderModelOptions,
          modelPicker: {
            open: composer.picker.modelOpen,
            onOpenChange: composer.picker.setModelOpen,
          },
          traitsPicker: {
            open: composer.picker.traitsOpen,
            onOpenChange: composer.picker.setTraitsOpen,
          },
          combinedPicker: {
            open: composer.picker.combinedOpen,
            onOpenChange: composer.picker.setCombinedOpen,
          },
          shortcutLabels,
        },
      },
    },
    composer: {
      formRef: composerInteraction.focus.formRef,
      focus: composerInteraction.focus.schedule,
      setPromptFromTraits: composerInteraction.promptMutation.setFromTraits,
    },
    threadReset: {
      threadId: identity.threadId,
      resetLocalDispatch: runtimeActivity.dispatch.reset,
      closeExpandedImage: overlays.expandedImage.close,
      dragDepthRef: composerInteraction.drag.dragDepthRef,
      setIsDragOverComposer: composerInteraction.drag.setIsDragOverComposer,
    },
  });

  useChatWorkspaceShortcutsOwner({
    enabled: app.shell.surfaceMode !== "split" || app.shell.isFocusedPane,
    activeThreadId: thread.activeThreadId,
    keybindings,
    composer: {
      formRef: composerInteraction.focus.formRef,
      approvalActive: runtimeActivity.pending.isComposerApprovalState,
      voiceRecording: composerInteraction.voice.isVoiceRecording,
      voiceTranscribing: composerInteraction.voice.isVoiceTranscribing,
      scheduleFocus: composerInteraction.focus.schedule,
      toggleFocus: composerInteraction.focus.toggle,
      openModelPicker: () => composer.picker.setModelOpen(true),
      openTraitsPicker: () => composer.picker.setTraitsOpen(true),
    },
    model: {
      selectedProvider: sessionWorkspace.provider.selectedProvider,
      selectedModel: sessionWorkspace.provider.selectedModel,
      optionsByProvider: sessionWorkspace.provider.catalog.modelOptionsByProvider,
      select: composerControls.providerSelection,
    },
    controller: {
      open: terminalState.terminalOpen,
      activeTerminalId: terminalState.activeTerminalId,
      workspaceOpen: sessionWorkspace.terminal.workspaceOpen,
      workspaceLayout: terminalState.workspaceLayout,
      toggleVisibility: sessionWorkspace.terminal.toggleVisibility,
      setOpen: sessionWorkspace.terminal.setOpen,
      splitRight: sessionWorkspace.terminal.splitRight,
      splitLeft: sessionWorkspace.terminal.splitLeft,
      splitDown: sessionWorkspace.terminal.splitDown,
      splitUp: sessionWorkspace.terminal.splitUp,
      close: sessionWorkspace.terminal.closeTerminal,
      create: sessionWorkspace.terminal.createFromShortcut,
      openFullWidth: sessionWorkspace.terminal.openNewFullWidth,
      closeWorkspaceView: sessionWorkspace.terminal.closeActiveWorkspaceView,
      setWorkspaceTab: sessionWorkspace.terminal.setWorkspaceTab,
    },
    panels: {
      toggleDiff: sessionWorkspace.panels.toggleDiff,
      toggleBrowser: sessionWorkspace.panels.toggleBrowser,
    },
    terminal: workspaceActions,
    project: sessionWorkspace.project.value,
    hasLiveTurn: runtimeActivity.session.hasLiveTurn,
  });

  const threadHeader = useChatThreadHeaderController({
    thread: {
      active: thread.activeThread,
      isLocalDraft: thread.isLocalDraftThread,
      isHomeChat: sessionWorkspace.workspace.isChatProject,
      isEmpty: timelineEntries.length === 0,
    },
    handoff: {
      hasProject: Boolean(sessionWorkspace.project.value),
      isServerThread: thread.isServerThread,
      isBusy: runtimeActivity.presentation.isWorking,
      hasPendingApprovals: runtimeActivity.pending.pendingApprovals.length > 0,
      hasPendingUserInput: runtimeActivity.pending.pendingUserInputs.length > 0,
      providerStatuses: composerInteraction.availability.providerStatuses,
    },
    banners: {
      rateLimitDismissalKey: sessionWorkspace.runtime.rateLimitBannerDismissalKey,
      setDismissedRateLimitBannerKey: overlays.setDismissedRateLimitBannerKey,
      setThreadError: thread.setThreadError,
    },
  });

  return {
    composerInteraction,
    composerControls,
    workspaceActions,
    timeline,
    threadHeader,
    shell: {
      secondaryChrome,
      pinnedMessages,
      threadMarkers,
      threadNotes,
      isCenteredEmptyLanding,
      isEmptyChatLanding,
      shouldRenderChatPaneContent,
      shouldShowProviderHealthBanner: shouldRenderProviderHealthBanner({
        threadEntryPoint: terminalState.entryPoint,
        terminalWorkspaceTerminalTabActive,
      }),
      keybindings,
      availableEditors,
      shortcutLabels,
      hasNativeUserMessages,
      envLocked: Boolean(
        thread.activeThread &&
        (thread.activeThread.messages.length > 0 ||
          (thread.activeThread.session !== null &&
            thread.activeThread.session.status !== "closed")),
      ),
    },
  };
}

export type ChatViewInteractionGraphOwner = ReturnType<typeof useChatViewInteractionGraphOwner>;
