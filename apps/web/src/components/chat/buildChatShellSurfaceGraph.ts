// FILE: buildChatShellSurfaceGraph.ts
// Purpose: Build header, overlays, transcript, workspace, and banner models.
// Layer: Web chat presentation composition

import { isElectron } from "../../env";
import { buildChatHeaderEnvironmentPresentation } from "../../hooks/useChatHeaderEnvironmentPresentationOwner";
import { buildChatOverlayPresentation } from "../../hooks/useChatOverlayPresentationOwner";
import type { ChatRuntimeGraphOwner } from "../../hooks/useChatRuntimeGraphOwner";
import { buildChatTranscriptSurface } from "../../hooks/useChatTranscriptSurfaceOwner";
import type { ChatViewExecutionGraphOwner } from "../../hooks/useChatViewExecutionGraphOwner";
import type { ChatViewFoundationOwner } from "../../hooks/useChatViewFoundationOwner";
import type { ChatViewInteractionGraphOwner } from "../../hooks/useChatViewInteractionGraphOwner";
import type { ChatViewProps } from "./ChatView.types";
import type { buildChatComposerSurfaceGraph } from "./buildChatComposerSurfaceGraph";

type ComposerSurfaceGraph = ReturnType<typeof buildChatComposerSurfaceGraph>;

export interface ChatShellSurfaceGraphInput {
  readonly foundation: ChatViewFoundationOwner;
  readonly runtimeGraph: ChatRuntimeGraphOwner;
  readonly interactionGraph: ChatViewInteractionGraphOwner;
  readonly executionGraph: ChatViewExecutionGraphOwner;
  readonly composerSurface: ComposerSurfaceGraph;
  readonly navigation: Pick<
    ChatViewProps,
    "onChangeThreadInSplitPane" | "onCloseThreadPane" | "onOpenHighlightsPanel" | "viewModeAction"
  >;
}

export function buildChatShellSurfaceGraph(input: ChatShellSurfaceGraphInput) {
  const { foundation, runtimeGraph, interactionGraph, executionGraph, composerSurface } = input;
  const { app, overlays, thread } = foundation;
  const { runtimeActivity, sessionWorkspace } = runtimeGraph;
  const { composerInteraction, composerControls, shell, timeline, workspaceActions } =
    interactionGraph;
  const { automation, command, turn } = executionGraph;
  const activeThread = thread.activeThread;
  if (!activeThread) {
    throw new Error("Chat shell surface requires an active thread.");
  }
  const terminalPresentation = workspaceActions.terminalPresentation;
  const terminalState = sessionWorkspace.terminal.terminalState;

  const headerEnvironment = buildChatHeaderEnvironmentPresentation({
    shell: {
      isEditorRail: app.shell.isEditorRail,
      isElectron,
      desktopTopBarTrafficLightGutterClassName:
        app.shell.desktopTopBarTrafficLightGutterClassName ?? "",
      desktopTopBarWindowControlsGutterClassName:
        app.shell.desktopTopBarWindowControlsGutterClassName ?? "",
      isFocusedPane: app.shell.isFocusedPane,
      surfaceMode: app.shell.surfaceMode,
    },
    thread: {
      active: activeThread,
      entryPoint: terminalState.entryPoint,
      header: interactionGraph.threadHeader,
      isTemporarySidechat: thread.isTemporarySidechat,
      sidechatPromotionBusy: runtimeActivity.sidechat.busy,
      sidechatPromotionDisabled: runtimeActivity.sidechat.disabled,
    },
    project: {
      active: sessionWorkspace.project.value,
      activeProjectId: sessionWorkspace.project.id,
      availableEditors: shell.availableEditors,
      branchToolbar: composerSurface.accessory.branchToolbar,
      canCopyProjectInstructionsToNotes: !thread.isLocalDraftThread,
      displayName: sessionWorkspace.project.displayName ?? undefined,
      diffToggleShortcutLabel: shell.shortcutLabels.diff,
      isGitRepo: sessionWorkspace.workspace.git.isRepo,
      keybindings: shell.keybindings,
      lastInvokedScriptId: workspaceActions.projectScripts.lastInvokedScriptId,
      projectInstructions: sessionWorkspace.project.instructions,
      workspaceCwd: sessionWorkspace.workspace.git.cwd,
    },
    environment: {
      automationDefinitions: automation.automation.data.definitions,
      controller: workspaceActions.environmentPanel,
      isStudioChat: sessionWorkspace.workspace.container.isStudio,
      showGitActions: sessionWorkspace.workspace.git.showActions,
      diffOpen: sessionWorkspace.panels.resolvedDiffOpen,
      diffDisabledReason: sessionWorkspace.workspace.environment.diffDisabledReason,
      diffTotals: timeline.diff.repoDiffTotals,
      pinnedMessages: shell.pinnedMessages,
      threadMarkers: shell.threadMarkers,
      pinnedMessageTextById: timeline.references.pinnedMessageTextById,
      markerMessageTextById: timeline.references.markerMessageTextById,
      notes: shell.threadNotes,
    },
    navigation: {
      onChangeThreadInSplitPane: input.navigation.onChangeThreadInSplitPane,
      onCloseThreadPane: input.navigation.onCloseThreadPane,
      onNavigateToThread: timeline.navigation.navigation.toThread,
      onNewEditorChat: timeline.navigation.editor.newChat,
      onOpenEditorChat: timeline.navigation.editor.openChat,
      onOpenEditorView: input.navigation.viewModeAction?.onClick ?? null,
      onOpenGithubRepository: sessionWorkspace.panels.openBrowserUrl,
      onOpenHighlightsPanel: input.navigation.onOpenHighlightsPanel,
    },
    actions: {
      deleteProjectScript: workspaceActions.projectScripts.deleteProjectScript,
      onCloseTerminal: terminalPresentation.editorActions.closeTerminal,
      onNewTerminal: terminalPresentation.editorActions.openTerminal,
      onOpenTerminal: terminalPresentation.editorActions.openTerminal,
      onPromoteSidechat: () => void runtimeActivity.sidechat.promote(),
      onRunProjectScript: timeline.navigation.scripts.runFromHeader,
      saveProjectScript: workspaceActions.projectScripts.saveProjectScript,
      terminalAvailable: terminalState.terminalOpen,
      terminalHasRunningActivity: terminalState.runningTerminalIds.length > 0,
      terminalTabActive: workspaceActions.layout.terminalWorkspaceTerminalTabActive,
      updateProjectScript: workspaceActions.projectScripts.updateProjectScript,
      onProjectInstructionsChange: sessionWorkspace.project.setInstructions,
      onCopyProjectInstructionsToNotes: timeline.references.copyProjectInstructionsToNotes,
      onToggleDiff: sessionWorkspace.panels.toggleDiff,
      onOpenAutomation: automation.automation.openEdit,
      onJumpToPinnedMessage: timeline.references.jumpToPinnedMessage,
      onTogglePinnedMessageDone: timeline.references.togglePinnedMessageDone,
      onUnpinMessage: timeline.references.unpinMessage,
      onRenamePinnedMessage: timeline.references.renamePinnedMessage,
      onJumpToThreadMarker: timeline.references.jumpToThreadMarker,
      onRemoveThreadMarker: timeline.markers.removeMarker,
      onNotesChange: timeline.references.changeNotes,
    },
  });

  const overlay = buildChatOverlayPresentation({
    dialog: {
      rename: interactionGraph.threadHeader.rename.dialog,
      automation: automation.automation.form
        ? {
            open: automation.automation.open,
            editing: automation.automation.editing,
            form: automation.automation.form,
            projects: sessionWorkspace.project.automationProjects,
            threads: sessionWorkspace.project.automationThreads,
            warnings: automation.automation.warnings,
            acknowledgedWarningIds: automation.automation.acknowledgedWarningIds,
            onToggleWarning: automation.automation.toggleWarning,
            onOpenChange: automation.automation.setOpen,
            onFormChange: automation.automation.updateForm,
            onSubmit: automation.automation.submit,
            busy: automation.automation.submitting,
          }
        : null,
    },
    slash: {
      open: command.slash.statusDialogOpen,
      onOpenChange: command.slash.setStatusDialogOpen,
      selectedModel: sessionWorkspace.provider.selectedModel,
      fastModeEnabled: composerControls.modelControls.composerTraitSelection.fastModeEnabled,
      selectedPromptEffort: sessionWorkspace.provider.selectedPromptEffort,
      interactionMode: sessionWorkspace.runtime.interactionMode,
      envMode: sessionWorkspace.workspace.environment.mode,
      envState: sessionWorkspace.workspace.environment.state,
      branch: activeThread.branch ?? sessionWorkspace.workspace.git.activeRootBranch,
      contextWindow: sessionWorkspace.runtime.contextWindow,
      cumulativeCostUsd: sessionWorkspace.runtime.cumulativeCostUsd,
      rateLimitStatus: sessionWorkspace.runtime.rateLimitStatus,
      activeContextWindowLabel:
        composerControls.modelControls.contextWindowSelectionStatus.activeLabel,
      pendingContextWindowLabel:
        composerControls.modelControls.contextWindowSelectionStatus.pendingSelectedLabel,
    },
    worktree: {
      handoff: {
        open: workspaceActions.workspaceHandoff.worktreeHandoffDialogOpen,
        worktreeName: workspaceActions.workspaceHandoff.worktreeHandoffName,
        busy: workspaceActions.workspaceHandoff.handoffBusy,
        onWorktreeNameChange: workspaceActions.workspaceHandoff.setWorktreeHandoffName,
        onOpenChange: workspaceActions.workspaceHandoff.setWorktreeHandoffDialogOpen,
        onConfirm: workspaceActions.workspaceHandoff.confirmWorktreeHandoff,
      },
    },
    selection: {
      inactiveSplitPane: app.shell.isInactiveSplitPane,
      action: timeline.selection.pendingTranscriptSelectionAction,
      onHighlight: timeline.markers.createHighlight,
      onAddToChat: timeline.selection.commitTranscriptAssistantSelection,
      hasVisibleSidechatTarget: Boolean(
        terminalPresentation.rightDock.visibleSidechatTargetThreadId,
      ),
      onAddToSidechat: timeline.selection.addToSidechatFromPendingSelection,
      isTemporarySidechat: thread.isTemporarySidechat,
      onAskInSidechat: timeline.selection.startSidechatFromPendingSelection,
    },
    marker: {
      record: timeline.markers.editingMarkerRecord,
      anchorRect: timeline.markers.editingMarker?.anchorRect ?? null,
      onColorChange: timeline.markers.changeMarkerColor,
      onNoteChange: timeline.markers.changeMarkerNote,
      onRemove: timeline.markers.removeMarker,
      onClose: timeline.markers.closeEditingMarker,
    },
    image: {
      preview: overlays.expandedImage.preview,
      onClose: overlays.expandedImage.close,
      onNavigate: overlays.expandedImage.navigate,
    },
  });

  const transcriptSurface = buildChatTranscriptSurface({
    visibility: {
      shouldRenderChatPaneContent: shell.shouldRenderChatPaneContent,
      isCenteredEmptyLanding: shell.isCenteredEmptyLanding,
      secondaryChromeReady: shell.secondaryChrome.ready,
    },
    thread: {
      activeThreadId: activeThread.id,
      activeTurnId: activeThread.session?.activeTurnId ?? null,
      agentActivityDetail: runtimeActivity.activity.openAgentActivityDetail,
      worktreeSetup: runtimeActivity.dispatch.activeWorktreeSetup,
      activeTurnInProgress: runtimeActivity.presentation.activeTurnInProgress,
      activeTurnStartedAt: runtimeActivity.presentation.activeWorkStartedAt,
      activeProjectDisplayName: sessionWorkspace.project.displayName ?? undefined,
      isEditorRail: app.shell.isEditorRail,
      isHomeLanding: shell.isEmptyChatLanding,
      markdownCwd: sessionWorkspace.workspace.git.cwd,
      workspaceRoot: sessionWorkspace.project.value?.cwd,
    },
    timeline: {
      hasLiveOutput: runtimeActivity.presentation.hasLiveTranscriptOutput,
      hasStreamingAssistantText: runtimeActivity.presentation.hasStreamingAssistantText,
      initialScrollOffsetPx: timeline.scroll.initialScrollOffsetPx,
      chatFontSizePx: app.settings.chatFontSizePx,
      enteringUserMessageIds: runtimeActivity.transcript.enteringUserMessageIds,
      listRef: timeline.scroll.legendListRef,
      pinnedMessageIds: timeline.references.pinnedMessageIds,
      resolvedTheme: app.resolvedTheme,
      revertTurnCountByUserMessageId: timeline.diff.revertTurnCountByUserMessageId,
      scrollButtonVisible: timeline.scroll.showScrollToBottom,
      threadMarkers: shell.threadMarkers,
      timelineControllerRef: timeline.timeline.controllerRef,
      timelineEntries: runtimeActivity.transcript.timelineEntries,
      timestampFormat: app.timestampFormat,
      turnDiffSummaryByAssistantMessageId: timeline.diff.turnDiffSummaryByAssistantMessageId,
    },
    interactions: {
      isPendingSetupBubbleId: runtimeActivity.automation.isPendingSetupBubbleId,
      isRevertingCheckpoint: runtimeActivity.checkpoint.isRevertingCheckpoint,
      onCloseAgentActivityDetail: () => runtimeActivity.activity.setOpenAgentActivityId(null),
      onEditUserMessage: turn.edit.userMessage,
      onExpandTimelineImage: overlays.expandedImage.open,
      onIsAtEndChange: timeline.scroll.onIsAtEndChange,
      onMessagesClickCapture: timeline.markers.onMessagesClickCaptureWithMarkerEdit,
      onMessagesMouseUp: timeline.selection.onMessagesMouseUp,
      onMessagesPointerCancel: timeline.selection.onMessagesPointerCancel,
      onMessagesPointerDown: timeline.selection.onMessagesPointerDown,
      onMessagesPointerUp: timeline.selection.onMessagesPointerUp,
      onMessagesScroll: timeline.selection.onMessagesScroll,
      onMessagesTouchEnd: timeline.selection.onMessagesTouchEnd,
      onMessagesTouchMove: timeline.selection.onMessagesTouchMove,
      onMessagesTouchStart: timeline.selection.onMessagesTouchStart,
      onMessagesWheel: timeline.selection.onMessagesWheel,
      onOpenAgentActivity: runtimeActivity.activity.setOpenAgentActivityId,
      onOpenAssistantSelection: timeline.references.openAssistantSelection,
      onOpenAutomation: timeline.navigation.navigation.openAutomation,
      onOpenThread: timeline.navigation.navigation.toThread,
      onOpenTurnDiff: timeline.navigation.diff.openTurn,
      onRevertUserMessage: timeline.navigation.checkpoint.revertUserMessage,
      onScrollToBottom: timeline.scroll.onScrollToBottom,
      onTogglePinMessage: timeline.references.togglePinMessage,
      onUndoTurnFiles: runtimeActivity.checkpoint.undoTurnFiles,
    },
    composer: {
      content: composerSurface.composerSection,
      stackedChromeHeight: runtimeActivity.presentation.composerStackedChromeHeight,
    },
    accessory: {
      relocateLeadingControls: composerSurface.accessory.relocateLeadingControls,
      leadingControls: composerSurface.accessory.leadingControls,
      showLegacyBranchToolbar: composerSurface.accessory.showLegacyBranchToolbar,
      branchToolbar: composerSurface.accessory.branchToolbar,
      pullRequest: sessionWorkspace.panels.pullRequestDialogProps,
    },
    workspace: {
      controller: sessionWorkspace.terminal,
      drawerProps: terminalPresentation.drawerProps,
      isEditorRail: app.shell.isEditorRail,
      isWorking: runtimeActivity.presentation.isWorking,
      terminalWorkspaceTerminalTabActive:
        workspaceActions.layout.terminalWorkspaceTerminalTabActive,
    },
    environment: {
      controller: workspaceActions.environmentPanel,
      props: headerEnvironment.environmentPanelProps,
    },
    plan: {
      open: runtimeActivity.plan.open,
      activeTaskList: runtimeActivity.activity.activeTaskList,
      activeProposedPlan: runtimeActivity.plan.sidebarProposedPlan,
      onClose: runtimeActivity.plan.closeAndDismiss,
    },
  });

  return {
    headerSurfaceModel: headerEnvironment.headerSurfaceModel,
    dialogLayerModel: overlay.dialogLayerModel,
    overlayLayerModel: overlay.overlayLayerModel,
    workspaceSurfaceModel: transcriptSurface.workspaceSurfaceModel,
    banners: {
      providerStatus: shell.shouldShowProviderHealthBanner
        ? composerInteraction.availability.visibleActiveProviderStatus
        : null,
      dismissProvider: composerInteraction.availability.dismissActiveProviderHealthBanner,
      threadError: interactionGraph.threadHeader.banners.threadError,
      rateLimitStatus: sessionWorkspace.runtime.visibleRateLimitStatus,
      dismissRateLimit: interactionGraph.threadHeader.banners.rateLimit.onDismiss,
    },
  };
}
