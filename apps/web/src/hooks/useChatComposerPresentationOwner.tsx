// FILE: useChatComposerPresentationOwner.tsx
// Purpose: Build the chat composer's leading, landing, activity, action, and menu models.
// Layer: Web chat composer presentation owner

import type { ProjectId } from "@agent-group/contracts";

import type {
  ChatComposerSectionModel,
  ComposerLeadingControlsModel,
} from "../components/chat/ChatComposerSection";
import {
  EmptyLandingComposerControls,
  type EmptyLandingComposerControlsModel,
  type EmptyLandingProjectControl,
} from "../components/chat/EmptyLandingComposerControls";
import type { ComposerMenuOverlayModel } from "../components/chat/ComposerMenuOverlay";
import type { ComposerPrimaryActionModel } from "../components/chat/ComposerPrimaryAction";
import type { ComposerPendingActivityModel } from "../components/chat/ComposerStackedActivityRail";

type ActivityModel = ChatComposerSectionModel["activity"];
type LiveChangesModel = NonNullable<ActivityModel["liveChanges"]>;
type TaskListModel = NonNullable<ActivityModel["taskList"]>;
type QueueModel = ActivityModel["queue"];
type ApprovalModel = Extract<
  NonNullable<ComposerPendingActivityModel>,
  { kind: "approval" }
>["props"];
type UserInputModel = Extract<
  NonNullable<ComposerPendingActivityModel>,
  { kind: "user-input" }
>["props"];
type BranchModel = NonNullable<EmptyLandingComposerControlsModel["branch"]>;
type BranchToolbarProps = BranchModel["props"];
type ProjectPickerProps = Extract<
  NonNullable<EmptyLandingProjectControl>,
  { kind: "workspace-picker" }
>["props"];
type PlanFollowUpProps = Extract<ComposerPrimaryActionModel, { kind: "plan-follow-up" }>["props"];
type SendAction = Extract<ComposerPrimaryActionModel, { kind: "send" }>;
type LocalDirectoryMenuProps = Extract<
  NonNullable<ComposerMenuOverlayModel>,
  { kind: "local-directory" }
>["props"];
type CommandMenuProps = Extract<
  NonNullable<ComposerMenuOverlayModel>,
  { kind: "commands" }
>["props"];

export interface ChatComposerPresentationOwnerInput {
  thread: {
    id: BranchToolbarProps["threadId"];
    draftTemporary: boolean;
    hasTemporaryMarker: boolean;
  };
  workspace: {
    worktreesEnabled: boolean;
    isGitRepo: boolean;
    environmentPanelEnabled: boolean;
    centeredEmptyLanding: boolean;
    emptyChatLanding: boolean;
    localDraftThread: boolean;
    homeContainer: boolean;
    activeProject: { kind: string; id: ProjectId; cwd: string } | null;
    activeProjectDisplayName: string | null;
    resolvedWorktreePath: string | null;
    branchToolbar: Omit<BranchToolbarProps, "threadId">;
    projectActions: Pick<
      ProjectPickerProps,
      "onSelectProject" | "onSelectWorkspaceRoot" | "onCreateProjectFromPath" | "onResetToHome"
    >;
  };
  runtime: {
    usage: ComposerLeadingControlsModel["runtimeUsage"];
    extras: ComposerLeadingControlsModel["extras"];
    voiceRecording: boolean;
    voiceTranscribing: boolean;
    relocateLeadingControls: boolean;
  };
  composer: {
    activity: {
      latestTurnLive: boolean;
      liveDiff: Pick<LiveChangesModel, "fileCount" | "additions" | "deletions"> & {
        hasChanges: boolean;
        turnId: string | null;
      };
      onReviewLiveChanges: () => void;
      taskList: Omit<TaskListModel, "attachedToPrevious"> | null;
      planSidebarOpen: boolean;
      queue: Omit<QueueModel, "attachedToPrevious">;
      approval: ApprovalModel | null;
      userInput: UserInputModel | null;
    };
    primary: {
      pendingProgress: { isLastQuestion: boolean; canAdvance: boolean } | null;
      pendingIsResponding: boolean;
      pendingResolvedAnswers: boolean;
      phase: string;
      onInterrupt: () => Promise<void> | void;
      showPlanFollowUpPrompt: boolean;
      planFollowUp: PlanFollowUpProps;
      approvalState: boolean;
      pendingUserInputCount: number;
      voice: {
        visible: boolean;
        recording: boolean;
        transcribing: boolean;
        durationLabel: string;
        onClick: () => void;
      };
      send: {
        busy: boolean;
        connecting: boolean;
        preparingWorktree: boolean;
        hasSendableContent: boolean;
      };
    };
    menu: {
      open: boolean;
      approvalState: boolean;
      localFolderBrowserOpen: boolean;
      localDirectory: Omit<LocalDirectoryMenuProps, "rootLabel"> & {
        browseRootPath: string | null;
      };
      commands: Omit<CommandMenuProps, "triggerKind"> & {
        commandPickerActive: boolean;
        effectiveTriggerKind: CommandMenuProps["triggerKind"];
      };
    };
  };
  actions: {
    setDraftTemporary: (temporary: boolean) => void;
    markTemporary: () => void;
    clearTemporary: () => void;
  };
}

export function buildChatComposerPresentation(input: ChatComposerPresentationOwnerInput) {
  const voiceActive = input.runtime.voiceRecording || input.runtime.voiceTranscribing;
  const leadingControls: ComposerLeadingControlsModel = {
    extras: input.runtime.extras,
    runtimeUsage: input.runtime.usage,
    voiceActive,
  };

  const branchToolbarProps: BranchToolbarProps = {
    threadId: input.thread.id,
    ...input.workspace.branchToolbar,
  };
  const showLegacyBranchToolbar =
    input.workspace.worktreesEnabled &&
    input.workspace.isGitRepo &&
    !input.workspace.environmentPanelEnabled;
  const showLandingBranchToolbar =
    input.workspace.worktreesEnabled &&
    input.workspace.centeredEmptyLanding &&
    input.workspace.activeProject?.kind === "project" &&
    !input.workspace.homeContainer;
  const temporary = input.thread.draftTemporary || input.thread.hasTemporaryMarker;
  const toggleTemporary = () => {
    const next = !temporary;
    input.actions.setDraftTemporary(next);
    if (next) input.actions.markTemporary();
    else input.actions.clearTemporary();
  };
  const showProjectPicker =
    input.workspace.centeredEmptyLanding &&
    input.workspace.localDraftThread &&
    input.workspace.activeProject?.kind === "project";
  const project: EmptyLandingProjectControl = input.workspace.emptyChatLanding
    ? {
        kind: "workspace-picker",
        props: {
          align: "start",
          side: "top",
          triggerClassName: "h-7 py-1",
          showResetToHome: Boolean(input.workspace.resolvedWorktreePath),
          selectedWorkspaceRoot: input.workspace.resolvedWorktreePath,
          ...input.workspace.projectActions,
        },
      }
    : showProjectPicker && input.workspace.activeProject?.kind === "project"
      ? {
          kind: "project-picker",
          props: {
            align: "start",
            side: "top",
            triggerClassName: "h-7 py-1",
            selectionMode: "project",
            selectedProjectId: input.workspace.activeProject.id,
            selectedWorkspaceRoot: input.workspace.activeProject.cwd,
            showResetToHome: true,
            onSelectProject: input.workspace.projectActions.onSelectProject,
            onCreateProjectFromPath: input.workspace.projectActions.onCreateProjectFromPath,
            onResetToHome: input.workspace.projectActions.onResetToHome,
          },
        }
      : input.workspace.activeProjectDisplayName
        ? { kind: "label", displayName: input.workspace.activeProjectDisplayName }
        : null;
  const showLandingControls =
    input.workspace.centeredEmptyLanding &&
    (input.workspace.emptyChatLanding ||
      showProjectPicker ||
      project !== null ||
      showLandingBranchToolbar);
  const emptyLandingControlsModel: EmptyLandingComposerControlsModel | null = showLandingControls
    ? {
        project,
        branch: showLandingBranchToolbar
          ? {
              props: branchToolbarProps,
              showBranchSelector: input.workspace.isGitRepo,
              temporary,
              onToggleTemporary: toggleTemporary,
            }
          : null,
      }
    : null;

  const showLiveChanges =
    input.composer.activity.latestTurnLive && input.composer.activity.liveDiff.hasChanges;
  const liveChanges: ActivityModel["liveChanges"] = showLiveChanges
    ? {
        fileCount: input.composer.activity.liveDiff.fileCount,
        additions: input.composer.activity.liveDiff.additions,
        deletions: input.composer.activity.liveDiff.deletions,
        onReview: input.composer.activity.liveDiff.turnId
          ? input.composer.activity.onReviewLiveChanges
          : undefined,
      }
    : null;
  const showTaskList = Boolean(
    input.composer.activity.taskList && !input.composer.activity.planSidebarOpen,
  );
  const taskList: ActivityModel["taskList"] =
    input.composer.activity.taskList && showTaskList
      ? { ...input.composer.activity.taskList, attachedToPrevious: showLiveChanges }
      : null;
  const queue: QueueModel = {
    ...input.composer.activity.queue,
    attachedToPrevious: showLiveChanges || showTaskList,
  };
  const pending: ComposerPendingActivityModel = input.composer.activity.approval
    ? { kind: "approval", props: input.composer.activity.approval }
    : input.composer.activity.userInput
      ? { kind: "user-input", props: input.composer.activity.userInput }
      : null;

  const primary = buildPrimaryAction(input.composer.primary);
  const menuVisible = input.composer.menu.open && !input.composer.menu.approvalState;
  const { browseRootPath, ...localDirectoryProps } = input.composer.menu.localDirectory;
  const { commandPickerActive, effectiveTriggerKind, ...commandProps } =
    input.composer.menu.commands;
  const menu: ComposerMenuOverlayModel = !menuVisible
    ? null
    : input.composer.menu.localFolderBrowserOpen
      ? {
          kind: "local-directory",
          props: {
            ...localDirectoryProps,
            rootLabel: browseRootPath ?? "Local folders unavailable",
          },
        }
      : {
          kind: "commands",
          props: {
            ...commandProps,
            triggerKind: commandPickerActive ? "slash-command" : effectiveTriggerKind,
          },
        };

  return {
    runtimeUsageControlsProps: input.runtime.usage,
    relocateLeadingControls: input.runtime.relocateLeadingControls,
    leadingControls,
    branchToolbarProps,
    showLegacyBranchToolbar,
    temporary,
    emptyLandingControlsModel,
    emptyLandingControls: <EmptyLandingComposerControls model={emptyLandingControlsModel} />,
    activity: { liveChanges, taskList, queue, pending },
    primary,
    menuVisible,
    menu,
  };
}

function buildPrimaryAction(
  input: ChatComposerPresentationOwnerInput["composer"]["primary"],
): ComposerPrimaryActionModel {
  if (input.pendingProgress) {
    return {
      kind: "pending-input",
      disabled:
        input.pendingIsResponding ||
        (input.pendingProgress.isLastQuestion
          ? !input.pendingResolvedAnswers
          : !input.pendingProgress.canAdvance),
      label: input.pendingIsResponding
        ? "Submitting..."
        : input.pendingProgress.isLastQuestion
          ? "Submit answers"
          : "Next question",
    };
  }
  if (input.phase === "running") return { kind: "interrupt", onInterrupt: input.onInterrupt };
  if (input.pendingUserInputCount > 0 || input.voice.recording || input.voice.transcribing) {
    return { kind: "none" };
  }
  if (input.showPlanFollowUpPrompt) {
    return { kind: "plan-follow-up", props: input.planFollowUp };
  }
  const voice: SendAction["voice"] = input.voice.visible
    ? {
        disabled: input.approvalState || input.send.connecting || input.send.busy,
        isRecording: input.voice.recording,
        isTranscribing: input.voice.transcribing,
        durationLabel: input.voice.durationLabel,
        onClick: input.voice.onClick,
      }
    : null;
  return {
    kind: "send",
    voice,
    send: {
      disabled:
        input.send.busy ||
        input.send.connecting ||
        input.voice.transcribing ||
        !input.send.hasSendableContent,
      ariaLabel: input.send.connecting
        ? "Connecting"
        : input.voice.transcribing
          ? "Transcribing voice note"
          : input.send.preparingWorktree
            ? "Preparing worktree"
            : input.send.busy
              ? "Sending"
              : "Send message",
      pending: input.send.connecting || input.send.busy,
    },
  };
}
