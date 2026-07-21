// FILE: useChatWorkspaceActionsOwner.ts
// Purpose: Compose chat workspace, terminal, mode, handoff, and shortcut controllers.
// Layer: Web chat orchestration owner

import { useCallback } from "react";

import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useChatEnvironmentPanelController } from "./useChatEnvironmentPanelController";
import { useChatTerminalPresentationModel } from "./useChatTerminalPresentationModel";
import { useProjectScriptController } from "./useProjectScriptController";
import { useThreadModeController } from "./useThreadModeController";
import { useThreadWorkspaceHandoff } from "./useThreadWorkspaceHandoff";
import { useWorkspaceSelectionController } from "./useWorkspaceSelectionController";

type TerminalPresentationInput = Parameters<typeof useChatTerminalPresentationModel>[0];
type EnvironmentPanelInput = Parameters<typeof useChatEnvironmentPanelController>[0];
type ProjectScriptInput = Parameters<typeof useProjectScriptController>[0];
type ThreadModeInput = Parameters<typeof useThreadModeController>[0];
type WorkspaceHandoffInput = Parameters<typeof useThreadWorkspaceHandoff>[0];
type WorkspaceSelectionInput = Parameters<typeof useWorkspaceSelectionController>[0];

export interface ChatWorkspaceActionsOwnerInput {
  readonly thread: {
    readonly routeId: ThreadModeInput["threadId"];
    readonly activeId: TerminalPresentationInput["activeThreadId"];
    readonly active: EnvironmentPanelInput["runtime"]["thread"];
    readonly server: ThreadModeInput["serverThread"];
    readonly draft: WorkspaceSelectionInput["draftThread"];
    readonly isServer: boolean;
    readonly isLocalDraft: boolean;
    readonly hasNativeUserMessages: boolean;
  };
  readonly workspace: {
    readonly project: WorkspaceHandoffInput["activeProject"];
    readonly activeRootBranch: WorkspaceHandoffInput["activeRootBranch"];
    readonly associatedWorktree: WorkspaceHandoffInput["activeThreadAssociatedWorktree"];
    readonly gitCwd: TerminalPresentationInput["gitCwd"];
    readonly branchSourceCwd: EnvironmentPanelInput["workspace"]["branchSourceCwd"];
    readonly threadCwd: EnvironmentPanelInput["workspace"]["cwd"];
    readonly runtimeEnv: TerminalPresentationInput["runtimeEnv"];
    readonly isHomeContainer: boolean;
    readonly isStudioContainer: boolean;
    readonly centeredEmptyLanding: boolean;
    readonly surfaceMode: EnvironmentPanelInput["layout"]["surfaceMode"];
    readonly terminal: TerminalPresentationInput["controller"];
  };
  readonly composer: {
    readonly scheduleFocus: () => void;
    readonly addTerminalContext: TerminalPresentationInput["onAddTerminalContext"];
    readonly setDraftRuntimeMode: ThreadModeInput["setDraftRuntimeMode"];
    readonly setDraftInteractionMode: ThreadModeInput["setDraftInteractionMode"];
    readonly setDraftThreadContext: ThreadModeInput["setDraftThreadContext"];
  };
  readonly runtime: {
    readonly runtimeMode: ThreadModeInput["runtimeMode"];
    readonly interactionMode: ThreadModeInput["interactionMode"];
    readonly latestTurnSettled: boolean;
    readonly providerOptions: EnvironmentPanelInput["runtime"]["providerOptions"];
    readonly hasLiveTurn: boolean;
  };
  readonly settings: {
    readonly environment: EnvironmentPanelInput["settings"];
    readonly terminalShortcuts: TerminalPresentationInput["shortcuts"];
  };
  readonly actions: {
    readonly setThreadError: ProjectScriptInput["setThreadError"];
    readonly setStoreThreadWorkspace: WorkspaceHandoffInput["setStoreThreadWorkspace"];
    readonly syncServerShellSnapshot: WorkspaceHandoffInput["syncServerShellSnapshot"];
  };
}

export function useChatWorkspaceActionsOwner(input: ChatWorkspaceActionsOwnerInput) {
  const terminalWorkspaceOpen = input.workspace.terminal.workspaceOpen;
  const terminalWorkspaceTerminalTabActive =
    terminalWorkspaceOpen &&
    (input.workspace.terminal.terminalState.workspaceLayout === "terminal-only" ||
      input.workspace.terminal.terminalState.workspaceActiveTab === "terminal");
  const terminalWorkspaceChatTabActive =
    terminalWorkspaceOpen &&
    input.workspace.terminal.terminalState.workspaceLayout === "both" &&
    input.workspace.terminal.terminalState.workspaceActiveTab === "chat";
  const isTerminalPrimarySurface = input.workspace.terminal.terminalState.entryPoint === "terminal";
  const isTerminalEnvironmentContext =
    isTerminalPrimarySurface || terminalWorkspaceTerminalTabActive;

  const terminalPresentation = useChatTerminalPresentationModel({
    threadId: input.thread.routeId,
    activeThreadId: input.thread.activeId,
    projectCwd: input.workspace.project?.cwd ?? null,
    gitCwd: input.workspace.gitCwd,
    runtimeEnv: input.workspace.runtimeEnv,
    controller: input.workspace.terminal,
    shortcuts: input.settings.terminalShortcuts,
    onAddTerminalContext: input.composer.addTerminalContext,
  });

  const environmentPanel = useChatEnvironmentPanelController({
    layout: {
      centeredEmptyLanding: input.workspace.centeredEmptyLanding,
      terminalPrimarySurface: isTerminalPrimarySurface,
      terminalEnvironmentContext: isTerminalEnvironmentContext,
      rightDockOpen: terminalPresentation.rightDock.open,
      surfaceMode: input.workspace.surfaceMode,
    },
    settings: input.settings.environment,
    workspace: {
      branchSourceCwd: input.workspace.branchSourceCwd,
      cwd: input.workspace.threadCwd,
    },
    runtime: {
      thread: input.thread.active,
      latestTurnSettled: input.runtime.latestTurnSettled,
      providerOptions: input.runtime.providerOptions,
    },
  });

  const projectScripts = useProjectScriptController({
    activeThreadId: input.thread.activeId,
    project: input.workspace.project ?? null,
    requestTerminalFocus: input.workspace.terminal.requestFocus,
    routeThreadId: input.thread.routeId,
    setThreadError: input.actions.setThreadError,
    thread: input.thread.active ?? null,
    workingDirectory: input.workspace.gitCwd,
  });

  const threadMode = useThreadModeController({
    threadId: input.thread.routeId,
    serverThread: input.thread.server,
    isServerThread: input.thread.isServer,
    isLocalDraftThread: input.thread.isLocalDraft,
    runtimeMode: input.runtime.runtimeMode,
    interactionMode: input.runtime.interactionMode,
    setDraftRuntimeMode: input.composer.setDraftRuntimeMode,
    setDraftInteractionMode: input.composer.setDraftInteractionMode,
    setDraftThreadContext: input.composer.setDraftThreadContext,
    focusComposer: input.composer.scheduleFocus,
  });

  const workspaceHandoff = useThreadWorkspaceHandoff({
    activeProject: input.workspace.project,
    activeThread: input.thread.active ?? undefined,
    activeRootBranch: input.workspace.activeRootBranch,
    activeThreadAssociatedWorktree: input.workspace.associatedWorktree,
    isServerThread: input.thread.isServer,
    stopActiveThreadSession: threadMode.stopSession,
    runProjectScript: projectScripts.runProjectScript,
    setStoreThreadWorkspace: input.actions.setStoreThreadWorkspace,
    syncServerShellSnapshot: input.actions.syncServerShellSnapshot,
  });

  const interrupt = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !input.thread.active) return;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: input.thread.active.id,
      createdAt: new Date().toISOString(),
    });
  }, [input.thread.active]);

  const workspaceSelection = useWorkspaceSelectionController({
    activeRootBranch: input.workspace.activeRootBranch,
    activeThread: input.thread.active,
    draftThread: input.thread.draft,
    hasNativeUserMessages: input.thread.hasNativeUserMessages,
    isHomeContainer: input.workspace.isHomeContainer,
    isLocalDraftThread: input.thread.isLocalDraft,
    isServerThread: input.thread.isServer,
    isStudioContainer: input.workspace.isStudioContainer,
    scheduleComposerFocus: input.composer.scheduleFocus,
    syncServerShellSnapshot: input.actions.syncServerShellSnapshot,
    threadId: input.thread.routeId,
  });

  return {
    terminalPresentation,
    environmentPanel,
    projectScripts,
    threadMode,
    workspaceHandoff,
    interrupt,
    workspaceSelection,
    layout: {
      terminalWorkspaceOpen,
      terminalWorkspaceTerminalTabActive,
      terminalWorkspaceChatTabActive,
      isTerminalPrimarySurface,
      isTerminalEnvironmentContext,
    },
  };
}

export type ChatWorkspaceActionsOwner = ReturnType<typeof useChatWorkspaceActionsOwner>;
