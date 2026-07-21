// FILE: buildChatComposerSurfaceGraph.tsx
// Purpose: Build the complete composer surface from chat domain owners.
// Layer: Web chat presentation composition

import { AGENT_GROUP_CAPABILITIES } from "../../agentGroupCapabilities";
import type { ChatRuntimeGraphOwner } from "../../hooks/useChatRuntimeGraphOwner";
import { buildChatComposerPresentation } from "../../hooks/useChatComposerPresentationOwner";
import { buildChatComposerSection } from "../../hooks/useChatComposerSectionOwner";
import type { ChatViewExecutionGraphOwner } from "../../hooks/useChatViewExecutionGraphOwner";
import type { ChatViewFoundationOwner } from "../../hooks/useChatViewFoundationOwner";
import type { ChatViewInteractionGraphOwner } from "../../hooks/useChatViewInteractionGraphOwner";

export interface ChatComposerSurfaceGraphInput {
  readonly foundation: ChatViewFoundationOwner;
  readonly runtimeGraph: ChatRuntimeGraphOwner;
  readonly interactionGraph: ChatViewInteractionGraphOwner;
  readonly executionGraph: ChatViewExecutionGraphOwner;
  readonly paneScopeId: string;
}

export function buildChatComposerSurfaceGraph(input: ChatComposerSurfaceGraphInput) {
  const { foundation, runtimeGraph, interactionGraph, executionGraph } = input;
  const { app, composer, identity, thread } = foundation;
  const { draft } = composer;
  const { content, actions: draftActions, sendState } = draft;
  const { runtimeActivity, sessionWorkspace, references: selectedReferences } = runtimeGraph;
  const { composerControls, composerInteraction, shell, timeline, workspaceActions } =
    interactionGraph;
  const { command, turn } = executionGraph;
  const activeThread = thread.activeThread;
  if (!activeThread) {
    throw new Error("Chat composer surface requires an active thread.");
  }

  const presentation = buildChatComposerPresentation({
    thread: {
      id: activeThread.id,
      draftTemporary: thread.draftThread?.isTemporary === true,
      hasTemporaryMarker: thread.temporary.hasMarker,
    },
    workspace: {
      worktreesEnabled: AGENT_GROUP_CAPABILITIES.worktrees,
      isGitRepo: sessionWorkspace.workspace.git.isRepo,
      environmentPanelEnabled: workspaceActions.environmentPanel.enabled,
      centeredEmptyLanding: shell.isCenteredEmptyLanding,
      emptyChatLanding: shell.isEmptyChatLanding,
      localDraftThread: thread.isLocalDraftThread,
      homeContainer: sessionWorkspace.workspace.container.isHome,
      activeProject: sessionWorkspace.project.value ?? null,
      activeProjectDisplayName: sessionWorkspace.project.displayName ?? null,
      resolvedWorktreePath: sessionWorkspace.workspace.environment.worktreePath,
      branchToolbar: {
        onEnvModeChange: workspaceActions.workspaceSelection.onEnvModeChange,
        envLocked: shell.envLocked,
        onHandoffToWorktree: workspaceActions.workspaceHandoff.onHandoffToWorktree,
        onHandoffToLocal: workspaceActions.workspaceHandoff.onHandoffToLocal,
        handoffBusy: workspaceActions.workspaceHandoff.handoffBusy,
        onComposerFocusRequest: composerInteraction.focus.schedule,
        ...(sessionWorkspace.project.canCheckoutPullRequestIntoThread
          ? { onCheckoutPullRequestRequest: sessionWorkspace.panels.openPullRequestDialog }
          : {}),
      },
      projectActions: {
        onSelectProject: workspaceActions.workspaceSelection.selectProjectForEmptyDraft,
        onSelectWorkspaceRoot: workspaceActions.workspaceSelection.selectWorkspaceRoot,
        onCreateProjectFromPath: workspaceActions.workspaceSelection.createProjectFromPickerPath,
        onResetToHome: workspaceActions.workspaceSelection.resetWorkspaceToHome,
      },
    },
    runtime: {
      usage: {
        runtimeMode: sessionWorkspace.runtime.runtimeMode,
        onRuntimeModeChange: workspaceActions.threadMode.changeRuntimeMode,
        contextWindow: composerControls.modelControls.runtimeUsageContextWindow,
        cumulativeCostUsd: sessionWorkspace.runtime.cumulativeCostUsd,
        activeContextWindowLabel:
          composerControls.modelControls.contextWindowSelectionStatus.activeLabel,
        pendingContextWindowLabel:
          composerControls.modelControls.contextWindowSelectionStatus.pendingSelectedLabel,
      },
      extras: {
        interactionMode: sessionWorkspace.runtime.interactionMode,
        supportsFastMode:
          composerControls.modelControls.composerTraitSelection.caps.supportsFastMode,
        fastModeEnabled: composerControls.modelControls.composerTraitSelection.fastModeEnabled,
        onAddPhotos: composerInteraction.references.actions.addImages,
        onToggleFastMode: composerControls.modelControls.toggleFastMode,
        onSetPlanMode: workspaceActions.threadMode.setPlanMode,
      },
      voiceRecording: composerInteraction.voice.isVoiceRecording,
      voiceTranscribing: composerInteraction.voice.isVoiceTranscribing,
      relocateLeadingControls:
        composerControls.modelControls.footerControlsPlan.relocateLeadingControls,
    },
    composer: {
      activity: {
        latestTurnLive: sessionWorkspace.runtime.live,
        liveDiff: timeline.diff.activeTurnLiveDiffState,
        onReviewLiveChanges: timeline.navigation.diff.reviewActiveTurnChanges,
        taskList: runtimeActivity.activity.activeTaskList
          ? {
              activeTaskList: runtimeActivity.activity.activeTaskList,
              backgroundTaskCount: runtimeActivity.activity.activeBackgroundTasks?.activeCount ?? 0,
              compact: runtimeActivity.activity.activeTaskListCompact,
              onCompactChange: runtimeActivity.activity.setActiveTaskListCompact,
              onOpenSidebar: runtimeActivity.plan.show,
            }
          : null,
        planSidebarOpen: runtimeActivity.plan.open,
        queue: {
          queuedTurns: content.queuedTurns,
          onSteer: turn.queue.steer,
          onRemove: turn.queue.remove,
          onEdit: turn.queue.edit,
          cwd: sessionWorkspace.workspace.git.cwd ?? undefined,
        },
        approval: runtimeActivity.pending.activeApproval
          ? {
              approval: runtimeActivity.pending.activeApproval,
              pendingCount: runtimeActivity.pending.pendingApprovals.length,
              isResponding: runtimeActivity.pending.respondingApprovalRequestIds.includes(
                runtimeActivity.pending.activeApproval.requestId,
              ),
              onRespond: runtimeActivity.pending.respondToApproval,
            }
          : null,
        userInput:
          runtimeActivity.pending.pendingUserInputs.length > 0
            ? {
                pendingUserInputs: runtimeActivity.pending.pendingUserInputs,
                respondingRequestIds: runtimeActivity.pending.respondingUserInputRequestIds,
                answers: runtimeActivity.pending.activePendingDraftAnswers,
                questionIndex: runtimeActivity.pending.activePendingQuestionIndex,
                onToggleOption: runtimeActivity.pending.toggleActivePendingOption,
                onAdvance: runtimeActivity.pending.advanceActivePendingUserInput,
                onPrevious: runtimeActivity.pending.previousActivePendingQuestion,
                onCancel: runtimeActivity.pending.cancelActivePendingUserInput,
              }
            : null,
      },
      primary: {
        pendingProgress: runtimeActivity.pending.activePendingProgress,
        pendingIsResponding: runtimeActivity.pending.activePendingIsResponding,
        pendingResolvedAnswers: Boolean(runtimeActivity.pending.activePendingResolvedAnswers),
        phase: runtimeActivity.session.phase,
        onInterrupt: workspaceActions.interrupt,
        showPlanFollowUpPrompt: runtimeActivity.plan.showFollowUpPrompt,
        planFollowUp: {
          hasFeedback: content.prompt.trim().length > 0,
          busy: runtimeActivity.dispatch.isSendBusy || runtimeActivity.session.isConnecting,
          onImplementInNewThread: turn.plan.implementInNewThread,
        },
        approvalState: runtimeActivity.pending.isComposerApprovalState,
        pendingUserInputCount: runtimeActivity.pending.pendingUserInputs.length,
        voice: {
          visible: composerInteraction.voice.showVoiceNotesControl,
          recording: composerInteraction.voice.isVoiceRecording,
          transcribing: composerInteraction.voice.isVoiceTranscribing,
          durationLabel: composerInteraction.voice.voiceRecordingDurationLabel,
          onClick: composerInteraction.voice.toggleComposerVoiceRecording,
        },
        send: {
          busy: runtimeActivity.dispatch.isSendBusy,
          connecting: runtimeActivity.session.isConnecting,
          preparingWorktree: runtimeActivity.dispatch.isPreparingWorktree,
          hasSendableContent: sendState.hasSendableContent,
        },
      },
      menu: {
        open: command.menu.open,
        approvalState: runtimeActivity.pending.isComposerApprovalState,
        localFolderBrowserOpen: command.menu.isLocalFolderBrowserOpen,
        localDirectory: {
          mentionQuery: command.menu.mentionTriggerQuery,
          browseRootPath: command.menu.localFolderBrowseRootPath,
          homeDir: sessionWorkspace.provider.serverConfigQuery.data?.homeDir ?? null,
          onSelectEntry: command.editor.selectLocalDirectoryMention,
          onNavigateFolder: command.editor.navigateLocalFolder,
          handleRef: command.menu.localDirectoryMenuRef,
        },
        commands: {
          items: command.menu.items,
          resolvedTheme: app.resolvedTheme,
          isLoading: command.menu.isLoading,
          commandPickerActive: composer.commandState.commandPicker !== null,
          effectiveTriggerKind: command.menu.triggerKind,
          activeItemId: command.menu.activeItem?.id ?? null,
          onHighlightedItemChange: command.menu.onHighlightedItemChange,
          onSelect: command.menu.onSelect,
        },
      },
    },
    actions: {
      setDraftTemporary: (temporary) =>
        draftActions.setDraftThreadContext(identity.threadId, { isTemporary: temporary }),
      markTemporary: thread.temporary.mark,
      clearTemporary: thread.temporary.clear,
    },
  });

  const section = buildChatComposerSection({
    frame: {
      secondaryChromeReady: shell.secondaryChrome.ready,
      shouldRenderChatPaneContent: shell.shouldRenderChatPaneContent,
      centeredEmptyLanding: shell.isCenteredEmptyLanding,
      form: {
        ref: composerInteraction.focus.formRef,
        onSubmit: turn.send.dispatch,
        paneScopeId: input.paneScopeId,
      },
      providerClassName:
        sessionWorkspace.provider.composerProviderState.composerFrameClassName ?? "",
      surfaceClassName:
        sessionWorkspace.provider.composerProviderState.composerSurfaceClassName ?? "",
      menuVisible: presentation.menuVisible,
    },
    activity: {
      measureRef: runtimeActivity.presentation.measureComposerStackedChrome,
      presentation: presentation.activity,
    },
    editor: {
      pending: {
        approvalActive: runtimeActivity.pending.isComposerApprovalState,
        userInputCount: runtimeActivity.pending.pendingUserInputs.length,
        progress: runtimeActivity.pending.activePendingProgress
          ? {
              customAnswer: runtimeActivity.pending.activePendingProgress.customAnswer,
              activeQuestionOptionCount:
                runtimeActivity.pending.activePendingProgress.activeQuestion?.options.length ??
                null,
            }
          : null,
      },
      plan: {
        showFollowUpPrompt: runtimeActivity.plan.showFollowUpPrompt,
        proposed: runtimeActivity.plan.activeProposedPlan,
      },
      automation: {
        activeThreadId: identity.threadId,
        pendingThreadId: runtimeActivity.automation.conversation?.threadId,
        onCancel: runtimeActivity.automation.cancel,
      },
      menu: presentation.menu,
      references: {
        assistantSelections: content.assistantSelections,
        onOpenAssistantSelection: timeline.references.openAssistantSelection,
        fileComments: content.fileComments,
        pastedTexts: content.pastedTexts,
        files: content.files,
        images: content.images,
        nonPersistedImageIdSet: composerInteraction.references.nonPersistedImageIdSet,
        onExpandImage: foundation.overlays.expandedImage.open,
        onRemoveAssistantSelections:
          composerInteraction.references.actions.clearAssistantSelections,
        onRemoveFileComments: composerInteraction.references.actions.clearFileComments,
        onRemovePastedText: composerInteraction.references.actions.removePastedText,
        onShowPastedTextInField: composerInteraction.references.actions.showPastedTextInField,
        onRemoveFile: composerInteraction.references.actions.removeFile,
        onRemoveImage: composerInteraction.references.actions.removeImage,
      },
      prompt: {
        props: {
          ref: composerInteraction.focus.editorRef,
          cursor: composer.commandState.cursor,
          mentionReferences: selectedReferences.mentions,
          onRemoveTerminalContext: composerInteraction.references.actions.removeTerminalContext,
          onChange: composerInteraction.promptMutation.onEditorChange,
          onCommandKeyDown: command.keyboard.onCommandKey,
          onPaste: composerInteraction.references.dropzone.onComposerPaste,
        },
        value: content.prompt,
        terminalContexts: content.terminalContexts,
        canCollapsePastedText: runtimeActivity.presentation.canCollapsePastedTextToDraft,
        onCollapsePastedText: composerInteraction.references.actions.addPastedText,
        hasLiveTurn: runtimeActivity.session.hasLiveTurn,
        phase: runtimeActivity.session.phase,
        disabled: runtimeActivity.presentation.isComposerEditorDisabled,
      },
    },
    footer: {
      compact: composerControls.layout.isFooterCompact,
      presentation: {
        leadingControls: presentation.leadingControls,
        primary: presentation.primary,
        relocateLeadingControls: presentation.relocateLeadingControls,
      },
      plan: {
        modeActive: sessionWorkspace.runtime.interactionMode === "plan",
        onToggleMode: workspaceActions.threadMode.toggleInteractionMode,
        sidebarVisible: Boolean(
          runtimeActivity.activity.activeTaskList ||
          runtimeActivity.plan.sidebarProposedPlan ||
          runtimeActivity.plan.open,
        ),
        sidebarLabel: runtimeActivity.plan.toggleLabel,
        sidebarTitle: runtimeActivity.plan.toggleTitle,
        onToggleSidebar: runtimeActivity.plan.toggle,
      },
      context: {
        usage: composerControls.modelControls.runtimeUsageContextWindow,
        visible: composerControls.modelControls.footerControlsPlan.showContextMeter,
        cumulativeCostUsd: sessionWorkspace.runtime.cumulativeCostUsd ?? undefined,
        activeWindowLabel: composerControls.modelControls.contextWindowSelectionStatus.activeLabel,
        pendingWindowLabel:
          composerControls.modelControls.contextWindowSelectionStatus.pendingSelectedLabel,
      },
      modelControls: composerControls.modelControls.modelControlsModel,
      voice: {
        controlVisible: composerInteraction.voice.showVoiceNotesControl,
        recording: composerInteraction.voice.isVoiceRecording,
        transcribing: composerInteraction.voice.isVoiceTranscribing,
        connecting: runtimeActivity.session.isConnecting,
        sendBusy: runtimeActivity.dispatch.isSendBusy,
        durationLabel: composerInteraction.voice.voiceRecordingDurationLabel,
        waveformLevels: composerInteraction.voice.voiceWaveformLevels,
        cancel: composerInteraction.voice.cancelComposerVoiceRecording,
        submit: composerInteraction.voice.submitComposerVoiceRecording,
      },
    },
    landing: { controls: presentation.emptyLandingControls },
    deferred: { placeholderHeight: composerControls.layout.placeholderHeight },
  });

  return {
    ...section,
    presentation,
    accessory: {
      relocateLeadingControls: presentation.relocateLeadingControls,
      leadingControls: presentation.leadingControls,
      showLegacyBranchToolbar: presentation.showLegacyBranchToolbar,
      branchToolbar: presentation.branchToolbarProps,
    },
  };
}
