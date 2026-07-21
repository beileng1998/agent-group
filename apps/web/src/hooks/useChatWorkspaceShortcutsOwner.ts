// FILE: useChatWorkspaceShortcutsOwner.ts
// Purpose: Bind global chat shortcuts after workspace and model controllers are ready.
// Layer: Web chat orchestration owner

import { useChatKeyboardShortcuts } from "./useChatKeyboardShortcuts";
import type { ChatWorkspaceActionsOwner } from "./useChatWorkspaceActionsOwner";

type KeyboardInput = Parameters<typeof useChatKeyboardShortcuts>[0];

export interface ChatWorkspaceShortcutsOwnerInput {
  readonly enabled: KeyboardInput["enabled"];
  readonly activeThreadId: KeyboardInput["activeThreadId"];
  readonly keybindings: KeyboardInput["keybindings"];
  readonly composer: KeyboardInput["composer"];
  readonly model: KeyboardInput["model"];
  readonly panels: KeyboardInput["panels"];
  readonly terminal: ChatWorkspaceActionsOwner;
  readonly controller: Omit<KeyboardInput["terminal"], "terminalTabActive" | "chatTabActive">;
  readonly project: KeyboardInput["project"]["active"];
  readonly hasLiveTurn: boolean;
}

export function useChatWorkspaceShortcutsOwner(input: ChatWorkspaceShortcutsOwnerInput) {
  const { layout, projectScripts, interrupt } = input.terminal;
  useChatKeyboardShortcuts({
    enabled: input.enabled,
    activeThreadId: input.activeThreadId,
    keybindings: input.keybindings,
    composer: input.composer,
    model: input.model,
    terminal: {
      ...input.controller,
      workspaceOpen: input.controller.workspaceOpen,
      terminalTabActive: layout.terminalWorkspaceTerminalTabActive,
      chatTabActive: layout.terminalWorkspaceChatTabActive,
    },
    panels: input.panels,
    project: {
      active: input.project,
      runScript: projectScripts.runProjectScript,
    },
    turn: { live: input.hasLiveTurn, interrupt },
  });
}
