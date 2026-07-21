// FILE: useChatComposerCommandOwner.ts
// Purpose: Own composer command discovery, editing, selection, and keyboard behavior.
// Layer: Web chat composer domain owner

import { getModelCapabilities } from "@agent-group/shared/model";
import { threadExportBlockedReason } from "@agent-group/shared/threadExport";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildAgentGroupSessionMentionCandidates } from "../agentGroupSessionMentions";
import {
  AGENT_GROUP_APP_SLASH_COMMANDS,
  AGENT_GROUP_CAPABILITIES,
} from "../agentGroupCapabilities";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  stripComposerTriggerText,
  type ComposerTrigger,
} from "../composer-logic";
import { canOfferForkSlashCommand, canOfferSideSlashCommand } from "../composerSlashCommands";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import type { ComposerLocalDirectoryMenuHandle } from "../components/chat/ComposerLocalDirectoryMenu";
import { useComposerCommandKeyController } from "./useComposerCommandKeyController";
import { useComposerMenuModel } from "./useComposerMenuModel";
import { useComposerMenuSelectionController } from "./useComposerMenuSelectionController";
import { useComposerSlashCommands } from "./useComposerSlashCommands";
import { useComposerTriggerEditorController } from "./useComposerTriggerEditorController";

type CommandPicker = null | "fork-target" | "review-target";
type MenuModelInput = Parameters<typeof useComposerMenuModel>[0];
type TriggerEditorInput = Parameters<typeof useComposerTriggerEditorController>[0];
type SlashCommandsInput = Parameters<typeof useComposerSlashCommands>[0];
type MenuSelectionInput = Parameters<typeof useComposerMenuSelectionController>[0];
type CommandKeyInput = Parameters<typeof useComposerCommandKeyController>[0];
type SessionMentionInput = Parameters<typeof buildAgentGroupSessionMentionCandidates>[0];

export function useChatComposerCommandState(input: {
  threadId: MenuModelInput["threadId"];
  prompt: string;
  closeAuxiliaryPickers: () => void;
}) {
  const closeAuxiliaryPickersRef = useRef(input.closeAuxiliaryPickers);
  closeAuxiliaryPickersRef.current = input.closeAuxiliaryPickers;
  const [commandPicker, setCommandPicker] = useState<CommandPicker>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(input.prompt, input.prompt.length),
  );
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(input.prompt, input.prompt.length),
  );
  const menuOpenRef = useRef(false);
  const menuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const localDirectoryMenuRef = useRef<ComposerLocalDirectoryMenuHandle | null>(null);

  useEffect(() => {
    setCommandPicker(null);
    closeAuxiliaryPickersRef.current();
  }, [input.threadId]);

  return {
    commandPicker,
    highlightedItemId,
    cursor,
    trigger,
    setCommandPicker,
    setHighlightedItemId,
    setCursor,
    setTrigger,
    refs: {
      menuOpen: menuOpenRef,
      menuItems: menuItemsRef,
      activeMenuItem: activeMenuItemRef,
      localDirectoryMenu: localDirectoryMenuRef,
    },
  };
}

export type ChatComposerCommandState = ReturnType<typeof useChatComposerCommandState>;

interface KeyboardRuntimeState {
  hasActivePendingProgress: boolean;
  isComposerApprovalState: boolean;
  pendingUserInputCount: number;
}

export interface ChatComposerCommandOwnerInput {
  thread: {
    id: MenuModelInput["threadId"];
    active: SlashCommandsInput["activeThread"];
    project: SlashCommandsInput["activeProject"];
    activeProjectId: string | null;
    activeRootBranch: SlashCommandsInput["activeRootBranch"];
    isServerThread: boolean;
    isTemporarySidechat: boolean;
    mentionThreads: SessionMentionInput["threads"];
  };
  composer: {
    commandState: ChatComposerCommandState;
    prompt: string;
    promptRef: TriggerEditorInput["promptRef"];
    editorRef: TriggerEditorInput["composerEditorRef"];
    terminalContexts: TriggerEditorInput["terminalContexts"];
    imageCount: number;
    selectedSkillCount: number;
    selectedMentionCount: number;
    interactionMode: SlashCommandsInput["interactionMode"];
    runtimeMode: SlashCommandsInput["runtimeMode"];
  };
  provider: {
    kind: MenuModelInput["provider"];
    model: string | null | undefined;
    startOptions: MenuModelInput["providerOptions"];
    currentModelOptions: SlashCommandsInput["currentProviderModelOptions"];
    modelSelection: SlashCommandsInput["selectedModelSelection"];
    dynamicAgents: MenuModelInput["dynamicAgents"];
    searchableModelOptions: MenuModelInput["searchableModelOptions"];
    discoveryCwd: MenuModelInput["providerDiscoveryCwd"];
    piAgentDir: MenuModelInput["piAgentDir"];
  };
  workspace: {
    homeDir: MenuModelInput["homeDir"];
    cwd: MenuModelInput["workspaceCwd"];
    environmentMode: SlashCommandsInput["environmentMode"];
  };
  actions: {
    editor: Pick<
      TriggerEditorInput,
      | "clearComposerDraftContent"
      | "commitReplacementText"
      | "scheduleComposerFocus"
      | "setPrompt"
      | "setRestoredQueuedSourceProposedPlan"
    >;
    slash: Pick<
      SlashCommandsInput,
      | "syncServerShellSnapshot"
      | "navigateToThread"
      | "handleClearConversation"
      | "handleInteractionModeChange"
      | "setComposerDraftProviderModelOptions"
    >;
    selection: Pick<
      MenuSelectionInput,
      "onProviderModelSelect" | "updateSelectedMentions" | "updateSelectedSkills"
    >;
    keyboard: Pick<
      CommandKeyInput,
      "toggleInteractionMode" | "handlePromptHistoryKey" | "commitRecalledPrompt" | "send"
    > & {
      getRuntimeState: () => KeyboardRuntimeState;
    };
  };
}

function commandPickerItems(
  picker: Exclude<CommandPicker, null>,
  activeThread: SlashCommandsInput["activeThread"],
): ComposerCommandItem[] {
  if (picker === "fork-target") {
    return [
      {
        id: "fork-target:worktree",
        type: "fork-target",
        target: "worktree",
        label: "Fork Into New Worktree",
        description: "Continue in a new worktree",
      },
      {
        id: "fork-target:local",
        type: "fork-target",
        target: "local",
        label: "Fork Into Local",
        description:
          activeThread?.worktreePath || activeThread?.envMode === "worktree"
            ? "Continue in this local worktree"
            : "Continue in the current local thread",
      },
    ];
  }
  return [
    {
      id: "review-target:changes",
      type: "review-target",
      target: "changes",
      label: "Review Uncommitted Changes",
      description: "Review local uncommitted changes",
    },
    {
      id: "review-target:base-branch",
      type: "review-target",
      target: "base-branch",
      label: "Review Against Base Branch",
      description: "Review the current branch diff against its base",
    },
  ];
}

export function useChatComposerCommandOwner(input: ChatComposerCommandOwnerInput) {
  const { actions, composer, provider, thread, workspace } = input;
  const state = composer.commandState;
  const keyboardActionsRef = useRef(actions.keyboard);
  keyboardActionsRef.current = actions.keyboard;
  const selectedModelCaps = useMemo(
    () => getModelCapabilities(provider.kind, provider.model),
    [provider.kind, provider.model],
  );
  const supportsFastSlashCommand = selectedModelCaps.supportsFastMode;
  const fastModeEnabled =
    supportsFastSlashCommand &&
    (provider.currentModelOptions as { fastMode?: boolean } | undefined)?.fastMode === true;
  const promptWithoutActiveSlashTrigger =
    state.trigger?.kind === "slash-command"
      ? stripComposerTriggerText(composer.prompt, state.trigger)
      : composer.prompt;
  const eligibilityInput = {
    prompt: promptWithoutActiveSlashTrigger,
    imageCount: composer.imageCount,
    terminalContextCount: composer.terminalContexts.length,
    selectedSkillCount: composer.selectedSkillCount,
    selectedMentionCount: composer.selectedMentionCount,
    interactionMode: composer.interactionMode,
  };
  const canOfferForkCommand =
    thread.isServerThread &&
    thread.active !== undefined &&
    canOfferForkSlashCommand(eligibilityInput);
  const canOfferSideCommand =
    thread.isServerThread &&
    thread.active !== undefined &&
    canOfferSideSlashCommand({
      ...eligibilityInput,
      isSidechat: thread.isTemporarySidechat,
    });
  const canOfferExportCommand =
    thread.isServerThread &&
    thread.active !== undefined &&
    threadExportBlockedReason(thread.active) === null;
  const sessionMentions = useMemo(
    () =>
      buildAgentGroupSessionMentionCandidates({
        threads: thread.mentionThreads,
        activeThreadId: thread.active?.id ?? null,
        activeProjectId: thread.activeProjectId,
      }),
    [thread.active?.id, thread.activeProjectId, thread.mentionThreads],
  );
  const menuModel = useComposerMenuModel({
    canOfferExportCommand,
    canOfferForkCommand: AGENT_GROUP_CAPABILITIES.splitChat && canOfferForkCommand,
    canOfferSideCommand: AGENT_GROUP_CAPABILITIES.sidechat && canOfferSideCommand,
    commandPicker: state.commandPicker,
    compactionEligible:
      thread.isServerThread &&
      thread.active?.session !== null &&
      thread.active?.session?.status !== "closed",
    composerTrigger: state.trigger,
    dynamicAgents: provider.dynamicAgents,
    homeDir: workspace.homeDir,
    piAgentDir: provider.piAgentDir,
    provider: provider.kind,
    providerDiscoveryCwd: provider.discoveryCwd,
    providerOptions: provider.startOptions,
    searchableModelOptions: provider.searchableModelOptions,
    sessionMentions,
    supportsFastSlashCommand,
    threadId: thread.id,
    workspaceCwd: workspace.cwd,
  });
  const menuItems = useMemo(
    () =>
      state.commandPicker
        ? commandPickerItems(state.commandPicker, thread.active)
        : menuModel.normalComposerMenuItems,
    [menuModel.normalComposerMenuItems, state.commandPicker, thread.active],
  );
  const menuOpen = Boolean(state.trigger || state.commandPicker);
  const activeMenuItem = useMemo(
    () => menuItems.find((item) => item.id === state.highlightedItemId) ?? menuItems[0] ?? null,
    [menuItems, state.highlightedItemId],
  );
  state.refs.menuOpen.current = menuOpen;
  state.refs.menuItems.current = menuItems;
  state.refs.activeMenuItem.current = activeMenuItem;

  useEffect(() => {
    if (!menuOpen) {
      state.setHighlightedItemId(null);
      return;
    }
    state.setHighlightedItemId((existing) =>
      existing && menuItems.some((item) => item.id === existing)
        ? existing
        : (menuItems[0]?.id ?? null),
    );
  }, [menuItems, menuOpen, state.setHighlightedItemId]);

  useEffect(() => {
    state.setHighlightedItemId(null);
    state.setCursor(
      collapseExpandedComposerCursor(composer.promptRef.current, composer.promptRef.current.length),
    );
    state.setTrigger(
      detectComposerTrigger(composer.promptRef.current, composer.promptRef.current.length),
    );
  }, [
    composer.promptRef,
    state.setCursor,
    state.setHighlightedItemId,
    state.setTrigger,
    thread.id,
  ]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      state.setCommandPicker(null);
      state.setHighlightedItemId(null);
      state.setTrigger(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, state.setCommandPicker, state.setHighlightedItemId, state.setTrigger]);

  const editor = useComposerTriggerEditorController({
    ...actions.editor,
    composerCursor: state.cursor,
    composerEditorRef: composer.editorRef,
    promptRef: composer.promptRef,
    setComposerCursor: state.setCursor,
    setComposerHighlightedItemId: state.setHighlightedItemId,
    setComposerTrigger: state.setTrigger,
    terminalContexts: composer.terminalContexts,
    threadId: thread.id,
  });
  const slash = useComposerSlashCommands({
    ...actions.slash,
    activeProject: thread.project,
    activeThread: thread.active,
    activeRootBranch: thread.activeRootBranch,
    isServerThread: thread.isServerThread,
    supportsFastSlashCommand,
    canOfferCompactCommand: menuModel.canOfferCompactCommand,
    canOfferSideCommand,
    canOfferExportCommand,
    surfaceAppSlashCommands: AGENT_GROUP_APP_SLASH_COMMANDS,
    supportsTextNativeReviewCommand: menuModel.supportsTextNativeReviewCommand,
    fastModeEnabled,
    providerNativeCommands: menuModel.providerNativeCommands,
    providerCommandDiscoveryCwd: provider.discoveryCwd,
    selectedProvider: provider.kind,
    currentProviderModelOptions: provider.currentModelOptions,
    selectedModelSelection: provider.modelSelection,
    environmentMode: workspace.environmentMode,
    runtimeMode: composer.runtimeMode,
    interactionMode: composer.interactionMode,
    threadId: thread.id,
    openForkTargetPicker: () => {
      state.setCommandPicker("fork-target");
      state.setHighlightedItemId("fork-target:worktree");
    },
    openReviewTargetPicker: () => {
      state.setCommandPicker("review-target");
      state.setHighlightedItemId("review-target:changes");
    },
    editorActions: editor.slashEditorActions,
  });
  const selection = useComposerMenuSelectionController({
    ...actions.selection,
    applyComposerTriggerReplacement: editor.applyComposerTriggerReplacement,
    composerMenuItems: menuItems,
    handleForkTargetSelection: slash.handleForkTargetSelection,
    handleReviewTargetSelection: slash.handleReviewTargetSelection,
    handleSlashCommandSelection: slash.handleSlashCommandSelection,
    highlightedItemId: state.highlightedItemId,
    localFolderBrowseRootPath: menuModel.localFolderBrowseRootPath,
    navigateLocalFolder: editor.navigateLocalFolder,
    provider: provider.kind,
    resolveActiveComposerTrigger: editor.resolveActiveComposerTrigger,
    scheduleComposerFocus: actions.editor.scheduleComposerFocus,
    setCommandPicker: state.setCommandPicker,
    setHighlightedItemId: state.setHighlightedItemId,
  });
  const onCommandKey = useComposerCommandKeyController({
    resolveTrigger: editor.resolveActiveComposerTrigger,
    menuOpenRef: state.refs.menuOpen,
    menuItemsRef: state.refs.menuItems,
    activeMenuItemRef: state.refs.activeMenuItem,
    localDirectoryMenuRef: state.refs.localDirectoryMenu,
    localFolderBrowserOpen: menuModel.isLocalFolderBrowserOpen,
    hasActivePendingProgress: false,
    isComposerApprovalState: false,
    pendingUserInputCount: 0,
    clearSlashDraft: editor.slashEditorActions.clearComposerSlashDraft,
    toggleInteractionMode: () => keyboardActionsRef.current.toggleInteractionMode(),
    nudgeMenuHighlight: selection.nudgeComposerMenuHighlight,
    selectMenuItem: selection.selectComposerItem,
    handlePromptHistoryKey: (request) => {
      const runtime = keyboardActionsRef.current.getRuntimeState();
      return keyboardActionsRef.current.handlePromptHistoryKey({ ...request, ...runtime });
    },
    commitRecalledPrompt: () => keyboardActionsRef.current.commitRecalledPrompt(),
    send: (mode) => keyboardActionsRef.current.send(mode),
  });

  return {
    state: {
      commandPicker: state.commandPicker,
      highlightedItemId: state.highlightedItemId,
      cursor: state.cursor,
      trigger: state.trigger,
      setCommandPicker: state.setCommandPicker,
      setHighlightedItemId: state.setHighlightedItemId,
      setCursor: state.setCursor,
      setTrigger: state.setTrigger,
    },
    menu: {
      items: menuItems,
      open: menuOpen,
      activeItem: activeMenuItem,
      isLoading: menuModel.isComposerMenuLoading,
      isLocalFolderBrowserOpen: menuModel.isLocalFolderBrowserOpen,
      localFolderBrowseRootPath: menuModel.localFolderBrowseRootPath,
      mentionTriggerQuery: menuModel.mentionTriggerQuery,
      triggerKind:
        state.commandPicker !== null ? "slash-command" : menuModel.effectiveComposerTriggerKind,
      localDirectoryMenuRef: state.refs.localDirectoryMenu,
      onHighlightedItemChange: selection.highlightComposerItem,
      onSelect: selection.selectComposerItem,
    },
    editor: {
      applyTriggerReplacement: editor.applyComposerTriggerReplacement,
      navigateLocalFolder: editor.navigateLocalFolder,
      resolveActiveTrigger: editor.resolveActiveComposerTrigger,
      selectLocalDirectoryMention: editor.selectLocalDirectoryMention,
    },
    slash: {
      handleStandaloneCommand: slash.handleStandaloneSlashCommand,
      statusDialogOpen: slash.isSlashStatusDialogOpen,
      setStatusDialogOpen: slash.setIsSlashStatusDialogOpen,
    },
    keyboard: { onCommandKey },
  };
}
