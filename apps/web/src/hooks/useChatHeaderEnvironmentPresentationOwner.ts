// FILE: useChatHeaderEnvironmentPresentationOwner.ts
// Purpose: Build the chat header and Environment presentation models from domain inputs.
// Layer: Web chat presentation owner

import type { AutomationDefinition, ProjectScript } from "@agent-group/contracts";

import { isAgentGroupSession } from "../agentGroupCapabilities";
import type { ChatHeaderSurfaceModel } from "../components/chat/ChatHeaderSurface";
import type { EnvironmentPanelProps } from "../components/chat/environment/EnvironmentPanel";
import { heartbeatAutomationsForThread } from "../lib/automationForm";
import type { Project, Thread } from "../types";
import type { ChatEnvironmentPanelController } from "./useChatEnvironmentPanelController";
import type { useChatThreadHeaderController } from "./useChatThreadHeaderController";

type HeaderProps = ChatHeaderSurfaceModel["header"];
type EnvironmentProps = Omit<EnvironmentPanelProps, "open" | "variant">;
type ThreadHeaderController = ReturnType<typeof useChatThreadHeaderController>;
type EditorChatControls = NonNullable<HeaderProps["editorChatControls"]>;

type EnvironmentContentProps = Pick<
  EnvironmentProps,
  | "diffDisabledReason"
  | "diffTotals"
  | "markerMessageTextById"
  | "notes"
  | "pinnedMessages"
  | "pinnedMessageTextById"
  | "threadMarkers"
>;

type EnvironmentActions = Pick<
  EnvironmentProps,
  | "onCopyProjectInstructionsToNotes"
  | "onJumpToPinnedMessage"
  | "onJumpToThreadMarker"
  | "onNotesChange"
  | "onOpenAutomation"
  | "onProjectInstructionsChange"
  | "onRemoveThreadMarker"
  | "onRenamePinnedMessage"
  | "onToggleDiff"
  | "onTogglePinnedMessageDone"
  | "onUnpinMessage"
>;

export interface ChatHeaderEnvironmentPresentationInput {
  readonly shell: ChatHeaderSurfaceModel["shell"] & {
    readonly isFocusedPane: boolean;
    readonly surfaceMode: NonNullable<HeaderProps["surfaceMode"]>;
  };
  readonly thread: {
    readonly active: Thread;
    readonly entryPoint: HeaderProps["activeThreadEntryPoint"];
    readonly header: Pick<ThreadHeaderController, "handoff" | "presentation" | "rename">;
    readonly isTemporarySidechat: boolean;
    readonly sidechatPromotionBusy: boolean;
    readonly sidechatPromotionDisabled: boolean;
  };
  readonly project: {
    readonly active: Project | null | undefined;
    readonly activeProjectId: EnvironmentProps["activeProjectId"];
    readonly availableEditors: EnvironmentProps["availableEditors"];
    readonly branchToolbar: EnvironmentProps["branchToolbar"];
    readonly canCopyProjectInstructionsToNotes: boolean;
    readonly displayName: string | undefined;
    readonly diffToggleShortcutLabel: HeaderProps["diffToggleShortcutLabel"];
    readonly isGitRepo: boolean;
    readonly keybindings: EnvironmentProps["keybindings"];
    readonly lastInvokedScriptId: string | null;
    readonly projectInstructions: string;
    readonly workspaceCwd: string | null;
  };
  readonly environment: EnvironmentContentProps & {
    readonly automationDefinitions: readonly AutomationDefinition[];
    readonly controller: Pick<
      ChatEnvironmentPanelController,
      | "appliesContentInset"
      | "closeAfterAction"
      | "githubRepositories"
      | "githubRepository"
      | "recap"
      | "variant"
    >;
    readonly isStudioChat: boolean;
    readonly showGitActions: boolean;
    readonly diffOpen: boolean;
  };
  readonly navigation: {
    readonly onChangeThreadInSplitPane?: (() => void) | undefined;
    readonly onCloseThreadPane?: (() => void) | undefined;
    readonly onNavigateToThread: HeaderProps["onNavigateToThread"];
    readonly onNewEditorChat: EditorChatControls["onNewChat"];
    readonly onOpenEditorChat: EditorChatControls["onOpenChat"];
    readonly onOpenEditorView: EnvironmentProps["onOpenEditorView"];
    readonly onOpenGithubRepository: EnvironmentProps["onOpenGithubRepository"];
    readonly onOpenHighlightsPanel?: (() => void) | undefined;
  };
  readonly actions: EnvironmentActions & {
    readonly deleteProjectScript: HeaderProps["onDeleteProjectScript"];
    readonly onCloseTerminal: EditorChatControls["onCloseTerminal"];
    readonly onNewTerminal: EditorChatControls["onNewTerminal"];
    readonly onOpenTerminal: EditorChatControls["onOpenTerminal"];
    readonly onPromoteSidechat: () => void;
    readonly onRunProjectScript: (script: ProjectScript) => void;
    readonly saveProjectScript: HeaderProps["onAddProjectScript"];
    readonly terminalAvailable: boolean;
    readonly terminalHasRunningActivity: boolean;
    readonly terminalTabActive: boolean;
    readonly updateProjectScript: HeaderProps["onUpdateProjectScript"];
  };
}

export interface ChatHeaderEnvironmentPresentation {
  readonly environmentPanelProps: EnvironmentProps;
  readonly environmentAppliesContentInset: boolean;
  readonly environmentOverlayVariant: EnvironmentPanelProps["variant"];
  readonly headerSurfaceModel: ChatHeaderSurfaceModel;
}

export function buildChatHeaderEnvironmentPresentation(
  input: ChatHeaderEnvironmentPresentationInput,
): ChatHeaderEnvironmentPresentation {
  const { active } = input.thread;
  const { controller } = input.environment;
  const threadAutomationItems = heartbeatAutomationsForThread(
    input.environment.automationDefinitions,
    active.id,
  ).map((definition) => ({ definition }));

  const environmentPanelProps: EnvironmentProps = {
    gitCwd: input.project.workspaceCwd,
    openInTarget: input.project.workspaceCwd,
    githubRepository: controller.githubRepository,
    githubRepositories: controller.githubRepositories,
    isGitRepo: input.project.isGitRepo,
    keybindings: input.project.keybindings,
    availableEditors: input.project.availableEditors,
    activeThreadId: active.id,
    activeProvider: active.session?.provider ?? active.modelSelection.provider,
    isStudioChat: input.environment.isStudioChat,
    showGitActions: input.environment.showGitActions,
    diffOpen: input.environment.diffOpen,
    threadAutomations: threadAutomationItems,
    ...(input.environment.diffDisabledReason !== undefined
      ? { diffDisabledReason: input.environment.diffDisabledReason }
      : {}),
    diffTotals: input.environment.diffTotals,
    branchToolbar: input.project.branchToolbar,
    recap: controller.recap,
    pinnedMessages: input.environment.pinnedMessages,
    threadMarkers: input.environment.threadMarkers,
    pinnedMessageTextById: input.environment.pinnedMessageTextById,
    markerMessageTextById: input.environment.markerMessageTextById,
    notes: input.environment.notes,
    activeProjectId: input.project.activeProjectId,
    projectInstructions: input.project.projectInstructions,
    canCopyProjectInstructionsToNotes: input.project.canCopyProjectInstructionsToNotes,
    onProjectInstructionsChange: input.actions.onProjectInstructionsChange,
    onCopyProjectInstructionsToNotes: input.actions.onCopyProjectInstructionsToNotes,
    onToggleDiff: input.actions.onToggleDiff,
    onOpenAutomation: input.actions.onOpenAutomation,
    ...(input.navigation.onOpenGithubRepository
      ? { onOpenGithubRepository: input.navigation.onOpenGithubRepository }
      : {}),
    onJumpToPinnedMessage: input.actions.onJumpToPinnedMessage,
    onTogglePinnedMessageDone: input.actions.onTogglePinnedMessageDone,
    onUnpinMessage: input.actions.onUnpinMessage,
    onRenamePinnedMessage: input.actions.onRenamePinnedMessage,
    onJumpToThreadMarker: input.actions.onJumpToThreadMarker,
    onRemoveThreadMarker: input.actions.onRemoveThreadMarker,
    onViewAllHighlights: input.navigation.onOpenHighlightsPanel ?? null,
    onNotesChange: input.actions.onNotesChange,
    onOpenEditorView: input.navigation.onOpenEditorView ?? null,
    onClose: controller.closeAfterAction,
  };

  const headerSurfaceModel: ChatHeaderSurfaceModel = {
    shell: {
      isEditorRail: input.shell.isEditorRail,
      isElectron: input.shell.isElectron,
      desktopTopBarTrafficLightGutterClassName:
        input.shell.desktopTopBarTrafficLightGutterClassName,
      desktopTopBarWindowControlsGutterClassName:
        input.shell.desktopTopBarWindowControlsGutterClassName,
    },
    header: {
      activeThreadId: active.id,
      agentGroupId: isAgentGroupSession(active) ? input.project.activeProjectId : null,
      activeThreadTitle: input.thread.header.presentation.activeThreadTitle,
      activeThreadEntryPoint: input.thread.entryPoint,
      activeProvider:
        active.session?.status === "running" || active.session?.status === "connecting"
          ? active.session.provider
          : active.modelSelection.provider,
      activeProjectName: input.shell.isEditorRail ? undefined : input.project.displayName,
      threadBreadcrumbs: input.thread.header.presentation.threadBreadcrumbs,
      isSidechat: input.thread.isTemporarySidechat,
      sidechatPromotionBusy: input.thread.sidechatPromotionBusy,
      sidechatPromotionDisabled: input.thread.sidechatPromotionDisabled,
      hideSidebarControls: input.shell.isEditorRail,
      hideHandoffControls: true,
      isGitRepo: input.project.isGitRepo,
      openInTarget: input.project.workspaceCwd,
      activeProjectScripts: undefined,
      preferredScriptId: input.project.lastInvokedScriptId,
      keybindings: input.project.keybindings,
      availableEditors: input.project.availableEditors,
      diffToggleShortcutLabel: input.project.diffToggleShortcutLabel,
      handoffBadgeLabel: input.thread.header.handoff.badge.label,
      handoffActionLabel: input.thread.header.handoff.action.label,
      handoffDisabled: input.thread.header.handoff.action.disabled,
      handoffActionTargetProviders: input.thread.header.handoff.action.targetProviders,
      handoffBadgeSourceProvider: input.thread.header.handoff.badge.sourceProvider,
      handoffBadgeTargetProvider: input.thread.header.handoff.badge.targetProvider,
      gitCwd: input.project.workspaceCwd,
      diffTotals: input.environment.diffTotals,
      showGitActions: false,
      showDiffToggle: !input.shell.isEditorRail,
      diffOpen: input.environment.diffOpen,
      ...(input.environment.diffDisabledReason !== undefined
        ? { diffDisabledReason: input.environment.diffDisabledReason }
        : {}),
      environment: null,
      surfaceMode: input.shell.surfaceMode,
      chatLayoutAction: null,
      editorChatControls:
        input.shell.isEditorRail && input.project.active
          ? {
              projectId: input.project.active.id,
              activeSurface: input.actions.terminalTabActive ? "terminal" : "chat",
              terminalAvailable: input.actions.terminalAvailable,
              terminalHasRunningActivity: input.actions.terminalHasRunningActivity,
              onNewChat: input.navigation.onNewEditorChat,
              onNewTerminal: input.actions.onNewTerminal,
              onOpenChat: input.navigation.onOpenEditorChat,
              onOpenTerminal: input.actions.onOpenTerminal,
              onCloseTerminal: input.actions.onCloseTerminal,
            }
          : null,
      changeThreadAction:
        input.shell.surfaceMode === "split" &&
        input.shell.isFocusedPane &&
        input.navigation.onChangeThreadInSplitPane
          ? { label: "Change thread", onClick: input.navigation.onChangeThreadInSplitPane }
          : null,
      onRunProjectScript: input.actions.onRunProjectScript,
      onAddProjectScript: input.actions.saveProjectScript,
      onUpdateProjectScript: input.actions.updateProjectScript,
      onDeleteProjectScript: input.actions.deleteProjectScript,
      onToggleDiff: input.actions.onToggleDiff,
      onCreateHandoff: input.thread.header.handoff.action.create,
      onNavigateToThread: input.navigation.onNavigateToThread,
      onRenameThread: input.thread.header.rename.openDialog,
      ...(input.thread.isTemporarySidechat
        ? { onPromoteSidechat: input.actions.onPromoteSidechat }
        : {}),
      ...(input.navigation.onCloseThreadPane
        ? { onCloseThreadPane: input.navigation.onCloseThreadPane }
        : {}),
    },
  };

  return {
    environmentPanelProps,
    environmentAppliesContentInset: controller.appliesContentInset,
    environmentOverlayVariant: controller.variant,
    headerSurfaceModel,
  };
}
