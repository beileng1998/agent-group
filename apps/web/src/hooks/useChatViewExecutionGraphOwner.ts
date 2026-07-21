// FILE: useChatViewExecutionGraphOwner.ts
// Purpose: Compose automation, composer commands, and Turn dispatch for ChatView.
// Layer: Web chat composition root

import { dispatchThreadNotes } from "../pinnedMessages";
import { toastManager } from "../components/ui/toast";
import type { ChatRuntimeGraphOwner } from "./useChatRuntimeGraphOwner";
import { useChatTurnExecutionOwner } from "./useChatTurnExecutionOwner";
import type { ChatViewFoundationOwner } from "./useChatViewFoundationOwner";
import type { ChatViewInteractionGraphOwner } from "./useChatViewInteractionGraphOwner";

export interface ChatViewExecutionGraphOwnerInput {
  readonly foundation: ChatViewFoundationOwner;
  readonly runtimeGraph: ChatRuntimeGraphOwner;
  readonly interactionGraph: ChatViewInteractionGraphOwner;
}

export function useChatViewExecutionGraphOwner(input: ChatViewExecutionGraphOwnerInput) {
  const { foundation, runtimeGraph, interactionGraph } = input;
  const { app, composer, identity, store, thread } = foundation;
  const { draft } = composer;
  const { content, actions: draftActions } = draft;
  const { runtimeActivity, sessionWorkspace, references: selectedReferences } = runtimeGraph;
  const { composerInteraction, composerControls, shell, timeline, workspaceActions } =
    interactionGraph;

  return useChatTurnExecutionOwner({
    automation: {
      thread: { activeThreadId: thread.activeThread?.id ?? null },
      composer: {
        promptRef: composer.promptRef,
        store: {
          clearComposerContent: draftActions.clearComposerContent,
          setDraftThreadContext: draftActions.setDraftThreadContext,
          setInteractionMode: draftActions.setInteractionMode,
          setModelSelection: draftActions.setModelSelection,
          setPrompt: draftActions.setPrompt,
          setRuntimeMode: draftActions.setRuntimeMode,
        },
        setRestoredSource: composer.restoredQueue.setSource,
        setCursor: composer.commandState.setCursor,
        setTrigger: composer.commandState.setTrigger,
        focus: composerInteraction.focus.schedule,
        clearPromptHistoryForComposerReset: runtimeActivity.promptHistory.clearForComposerReset,
        setComposerHighlightedItemId: composer.commandState.setHighlightedItemId,
      },
      references: {
        addImages: composerInteraction.references.actions.addImagesToDraft,
        addFiles: composerInteraction.references.actions.addFilesToDraft,
        addAssistantSelection: composerInteraction.references.actions.addAssistantSelectionToDraft,
        addFileComment: composerInteraction.references.actions.addFileCommentToDraft,
        addTerminalContexts: composerInteraction.references.actions.addTerminalContextsToDraft,
        addPastedTexts: composerInteraction.references.actions.addPastedTextsToDraft,
        setSkills: selectedReferences.setSkills,
        setMentions: selectedReferences.setMentions,
      },
      automation: {
        activeProject: sessionWorkspace.project.value ?? null,
        activeProjectId: sessionWorkspace.project.id,
        activeThread: thread.activeThread ?? null,
        associatedWorktree: sessionWorkspace.workspace.environment.associatedWorktree,
        projects: sessionWorkspace.project.automationProjects,
        routeThreadId: identity.threadId,
        isServerThread: thread.isServerThread,
        threadNotes: shell.threadNotes,
        selectedModelSelection: sessionWorkspace.provider.selectedModelSelection,
        runtimeMode: sessionWorkspace.runtime.runtimeMode,
        interactionMode: sessionWorkspace.runtime.interactionMode,
        providerOptionsForDispatch: sessionWorkspace.provider.providerOptionsForDispatch,
      },
    },
    command: {
      thread: {
        id: identity.threadId,
        active: thread.activeThread,
        project: sessionWorkspace.project.value,
        activeProjectId: sessionWorkspace.project.id,
        activeRootBranch: sessionWorkspace.workspace.git.activeRootBranch,
        isServerThread: thread.isServerThread,
        isTemporarySidechat: thread.isTemporarySidechat,
        mentionThreads: sessionWorkspace.project.automationThreads,
      },
      composer: {
        commandState: composer.commandState,
        prompt: content.prompt,
        promptRef: composer.promptRef,
        editorRef: composerInteraction.focus.editorRef,
        terminalContexts: content.terminalContexts,
        imageCount: content.images.length,
        selectedSkillCount: selectedReferences.skills.length,
        selectedMentionCount: selectedReferences.mentions.length,
        interactionMode: sessionWorkspace.runtime.interactionMode,
        runtimeMode: sessionWorkspace.runtime.runtimeMode,
      },
      provider: {
        kind: sessionWorkspace.provider.selectedProvider,
        model: sessionWorkspace.provider.selectedModel,
        startOptions: sessionWorkspace.provider.providerOptionsForDispatch,
        currentModelOptions:
          sessionWorkspace.provider.selectedModelOptions?.[
            sessionWorkspace.provider.selectedProvider
          ],
        modelSelection: sessionWorkspace.provider.selectedModelSelection,
        dynamicAgents: sessionWorkspace.provider.catalog.selectedRuntimeAgents.map((agent) => ({
          name: agent.name,
          displayName: agent.displayName,
          ...(agent.description ? { description: agent.description } : {}),
        })),
        searchableModelOptions: sessionWorkspace.provider.searchableModelOptions,
        discoveryCwd: sessionWorkspace.provider.discoveryCwd,
        piAgentDir: app.settings.piAgentDir || null,
      },
      workspace: {
        homeDir: sessionWorkspace.provider.serverConfigQuery.data?.homeDir ?? null,
        cwd: sessionWorkspace.workspace.gitCwd,
        environmentMode: sessionWorkspace.workspace.environment.mode ?? null,
      },
      actions: {
        editor: {
          clearComposerDraftContent: draftActions.clearComposerContent,
          commitReplacementText: composerInteraction.promptMutation.commitReplacementText,
          scheduleComposerFocus: composerInteraction.focus.schedule,
          setPrompt: composer.setPrompt,
          setRestoredQueuedSourceProposedPlan: composer.restoredQueue.setSource,
        },
        slash: {
          syncServerShellSnapshot: store.syncServerShellSnapshot,
          navigateToThread: (nextThreadId, options) =>
            app.navigate({
              to: "/$threadId",
              params: { threadId: nextThreadId },
              ...(options?.splitViewId
                ? { search: () => ({ splitViewId: options.splitViewId }) }
                : {}),
            }),
          handleClearConversation: async () => {
            const project = sessionWorkspace.project.value;
            if (!project) {
              toastManager.add({
                type: "warning",
                title: "Clear is unavailable",
                description: "Open a project before starting a fresh thread.",
              });
              return;
            }
            await app.handleNewThread(project.id, { entryPoint: "chat" });
          },
          handleInteractionModeChange: workspaceActions.threadMode.changeInteractionMode,
          setComposerDraftProviderModelOptions: draftActions.setProviderModelOptions,
        },
        selection: {
          onProviderModelSelect: composerControls.providerSelection,
          updateSelectedMentions: selectedReferences.setMentions,
          updateSelectedSkills: selectedReferences.setSkills,
        },
        keyboard: {
          toggleInteractionMode: workspaceActions.threadMode.toggleInteractionMode,
          handlePromptHistoryKey: runtimeActivity.promptHistory.handleNavigationKey,
          commitRecalledPrompt: runtimeActivity.promptHistory.commitRecalledPrompt,
          getRuntimeState: () => ({
            hasActivePendingProgress: Boolean(runtimeActivity.pending.activePendingProgress),
            isComposerApprovalState: runtimeActivity.pending.isComposerApprovalState,
            pendingUserInputCount: runtimeActivity.pending.pendingUserInputs.length,
          }),
        },
      },
    },
    turn: {
      thread: {
        routeId: identity.threadId,
        active: thread.activeThread,
        project: sessionWorkspace.project.value,
        associatedWorktree: sessionWorkspace.workspace.environment.associatedWorktree,
        state: {
          isServerThread: thread.isServerThread,
          isLocalDraftThread: thread.isLocalDraftThread,
          hasNativeUserMessages: shell.hasNativeUserMessages,
          notes: shell.threadNotes,
        },
        destination: {
          activeRootBranch: sessionWorkspace.workspace.git.activeRootBranch ?? null,
          chatWorkspaceRoot: sessionWorkspace.project.chatWorkspaceRoot,
          isContainerLandingProject: sessionWorkspace.workspace.container.isLanding,
          isHomeChatContainer: sessionWorkspace.workspace.container.isHome,
          isStudioContainer: sessionWorkspace.workspace.container.isStudio,
          selectedWorkspaceRoot: sessionWorkspace.workspace.container.isLanding
            ? (sessionWorkspace.workspace.environment.worktreePath ?? null)
            : null,
          syncServerShellSnapshot: store.syncServerShellSnapshot,
          clearProjectDraftThreadId: draftActions.clearProjectDraftThreadId,
          setDraftThreadContext: draftActions.setDraftThreadContext,
          setStoreThreadError: store.setStoreThreadError,
        },
        plan: {
          proposed: runtimeActivity.plan.activeProposedPlan,
          showFollowUpPrompt: runtimeActivity.plan.showFollowUpPrompt,
          openForCurrentTurn: runtimeActivity.plan.showForCurrentTurn,
          openOnNextThread: runtimeActivity.plan.showOnNextThread,
        },
      },
      composer: {
        editorRef: composerInteraction.focus.editorRef,
        promptRef: composer.promptRef,
        content: {
          images: content.images,
          files: content.files,
          assistantSelections: content.assistantSelections,
          fileComments: content.fileComments,
          terminalContexts: content.terminalContexts,
          pastedTexts: content.pastedTexts,
          envMode: sessionWorkspace.workspace.environment.mode,
        },
        selectedSkillsRef: selectedReferences.skillsRef,
        selectedMentionsRef: selectedReferences.mentionsRef,
        isCenteredEmptyLanding: shell.isCenteredEmptyLanding,
        environmentPanel: {
          defaultOpen: workspaceActions.environmentPanel.defaultOpen,
          preferenceOpen: workspaceActions.environmentPanel.preferenceOpen,
          setPreferenceOpen: workspaceActions.environmentPanel.setPreferenceOpen,
        },
        actions: {
          focus: composerInteraction.focus.schedule,
          clearPromptHistory: runtimeActivity.promptHistory.clearForComposerReset,
          clearDraftContent: draftActions.clearComposerContent,
          setInteractionMode: draftActions.setInteractionMode,
          setHighlightedItemId: composer.commandState.setHighlightedItemId,
          setCursor: composer.commandState.setCursor,
          setTrigger: composer.commandState.setTrigger,
        },
        restored: {
          resolveForPrompt: composer.restoredQueue.resolveForPrompt,
          clearSource: composer.restoredQueue.setSource,
          afterFailure: {
            current: {
              prompt: composer.promptRef,
              images: composerInteraction.references.refs.images,
              files: composerInteraction.references.refs.files,
              assistantSelections: composerInteraction.references.refs.assistantSelections,
              fileComments: composerInteraction.references.refs.fileComments,
              terminalContexts: composerInteraction.references.refs.terminalContexts,
              pastedTexts: composerInteraction.references.refs.pastedTexts,
            },
            setPrompt: composer.setPrompt,
            setRestoredSourceProposedPlan: composer.restoredQueue.setSource,
            setComposerCursor: composer.commandState.setCursor,
            setComposerTrigger: composer.commandState.setTrigger,
          },
        },
        queue: {
          turns: content.queuedTurns,
          enqueue: draftActions.enqueueQueuedTurn,
          insert: draftActions.insertQueuedTurn,
          remove: draftActions.removeQueuedTurn,
        },
      },
      provider: {
        selectedProvider: sessionWorkspace.provider.selectedProvider,
        selectedModel: sessionWorkspace.provider.selectedModel,
        selectedPromptEffort: sessionWorkspace.provider.selectedPromptEffort,
        modelSelection: sessionWorkspace.provider.selectedModelSelection,
        options: sessionWorkspace.provider.providerOptionsForDispatch,
        rememberDispatch: composerInteraction.availability.rememberCustomBinaryPathForDispatch,
      },
      runtime: {
        assistantDeliveryMode: app.assistantDeliveryMode,
        runtimeMode: sessionWorkspace.runtime.runtimeMode,
        interactionMode: sessionWorkspace.runtime.interactionMode,
        phase: runtimeActivity.session.phase,
        hasLiveTurn: runtimeActivity.session.hasLiveTurn,
        isSendBusy: runtimeActivity.dispatch.isSendBusy,
        isConnecting: runtimeActivity.session.isConnecting,
        isVoiceTranscribing: composerInteraction.voice.isVoiceTranscribing,
        isRevertingCheckpoint: runtimeActivity.checkpoint.isRevertingCheckpoint,
        setHistoryMutationBusy: runtimeActivity.checkpoint.setIsRevertingCheckpoint,
        nonCodexSteerGateActive: runtimeActivity.session.steerGate.active,
        beginNonCodexSteerGate: runtimeActivity.session.steerGate.begin,
        isSendPreflightInFlight: composerInteraction.availability.isSendPreflightInFlight,
        runSendPreflight: composerInteraction.availability.runSendPreflight,
        pending: {
          hasApproval: runtimeActivity.pending.activeApproval !== null,
          hasProgress: runtimeActivity.pending.activePendingProgress !== null,
          userInputCount: runtimeActivity.pending.pendingUserInputs.length,
          submitFromComposer: runtimeActivity.pending.submitActivePendingUserInputFromComposer,
        },
      },
      localDispatch: {
        sendInFlightRef: composer.sendInFlightRef,
        begin: runtimeActivity.dispatch.begin,
        reset: runtimeActivity.dispatch.reset,
        failWorktreeSetup: runtimeActivity.dispatch.failWorktreeSetup,
        scheduleFailedWorktreeSetupReset: runtimeActivity.dispatch.scheduleFailedWorktreeSetupReset,
        createWorktree: (request) => app.createWorktreeMutation.mutateAsync(request),
        runProjectScript: workspaceActions.projectScripts.runProjectScript,
      },
      transcript: {
        appendOptimisticUserMessage: runtimeActivity.transcript.appendOptimisticUserMessage,
        removeOptimisticUserMessage: runtimeActivity.transcript.removeOptimisticUserMessage,
        armAutoFollow: timeline.scroll.armTranscriptAutoFollow,
        setThreadError: thread.setThreadError,
      },
      automation: {
        conversation: runtimeActivity.automation.conversation,
        armTranscriptAutoFollow: timeline.scroll.armTranscriptAutoFollow,
        setConversation: runtimeActivity.automation.setConversation,
        clearConversation: runtimeActivity.automation.clear,
        isResolveCurrent: runtimeActivity.automation.isResolveCurrent,
      },
      persistence: {
        persistThreadSettings: workspaceActions.threadMode.persistForNextTurn,
        setThreadWorkspace: store.setStoreThreadWorkspace,
        dispatchThreadNotes,
      },
    },
  });
}

export type ChatViewExecutionGraphOwner = ReturnType<typeof useChatViewExecutionGraphOwner>;
