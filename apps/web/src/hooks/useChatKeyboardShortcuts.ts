// FILE: useChatKeyboardShortcuts.ts
// Purpose: Own capture-phase keyboard routing for a chat surface.
// Layer: Web chat interaction controller

import {
  type ModelSlug,
  type ProviderKind,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@agent-group/contracts";
import { useEffect, type MutableRefObject } from "react";

import {
  canHandleComposerPickerShortcut,
  eventTargetsComposer,
} from "../components/chat/chatViewComposerValues";
import { resolveCycledModelSlug } from "../components/ChatView.logic";
import { isElectron } from "../env";
import { resolveShortcutCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isMacPlatform } from "../lib/utils";
import { readFavoriteModelSlugs } from "../lib/modelFavorites";
import type { ProviderModelOption } from "../providerModelOptions";
import { projectScriptIdFromCommand } from "../projectScripts";
import type { Project, ProjectScript } from "../types";

export function useChatKeyboardShortcuts(input: {
  enabled: boolean;
  activeThreadId: ThreadId | null;
  keybindings: ResolvedKeybindingsConfig;
  composer: {
    formRef: MutableRefObject<HTMLFormElement | null>;
    approvalActive: boolean;
    voiceRecording: boolean;
    voiceTranscribing: boolean;
    scheduleFocus: () => void;
    toggleFocus: () => void;
    openModelPicker: () => void;
    openTraitsPicker: () => void;
  };
  model: {
    selectedProvider: ProviderKind;
    selectedModel: string | null;
    optionsByProvider: Record<
      ProviderKind,
      ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
    >;
    select: (provider: ProviderKind, model: ModelSlug) => void;
  };
  terminal: {
    open: boolean;
    activeTerminalId: string;
    workspaceOpen: boolean;
    workspaceLayout: "both" | "terminal-only";
    terminalTabActive: boolean;
    chatTabActive: boolean;
    toggleVisibility: () => void;
    setOpen: (open: boolean) => void;
    splitRight: () => void;
    splitLeft: () => void;
    splitDown: () => void;
    splitUp: () => void;
    close: (terminalId: string) => unknown;
    create: () => void;
    openFullWidth: () => void;
    closeWorkspaceView: () => void;
    setWorkspaceTab: (tab: "chat" | "terminal") => void;
  };
  panels: {
    toggleDiff: () => void;
    toggleBrowser: () => void;
  };
  project: {
    active: Project | null | undefined;
    runScript: (script: ProjectScript) => unknown;
  };
  turn: {
    live: boolean;
    interrupt: () => unknown;
  };
}): void {
  useEffect(() => {
    if (!input.enabled) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!input.activeThreadId || event.defaultPrevented) return;
      if (
        input.turn.live &&
        isMacPlatform(navigator.platform) &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "c" &&
        eventTargetsComposer(event, input.composer.formRef.current)
      ) {
        event.preventDefault();
        event.stopPropagation();
        void input.turn.interrupt();
        return;
      }
      const composerPickerShortcutActive =
        !isTerminalFocused() &&
        !input.composer.voiceRecording &&
        !input.composer.voiceTranscribing &&
        !input.composer.approvalActive &&
        canHandleComposerPickerShortcut(event, input.composer.formRef.current);
      const command = resolveShortcutCommand(event, input.keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: input.terminal.open,
          terminalWorkspaceOpen: input.terminal.workspaceOpen,
          terminalWorkspaceTerminalOnly: input.terminal.workspaceLayout === "terminal-only",
          terminalWorkspaceTerminalTabActive: input.terminal.terminalTabActive,
          terminalWorkspaceChatTabActive: input.terminal.chatTabActive,
        },
      });
      if (!command) return;

      if (command === "composer.focus.toggle") {
        if (
          input.composer.approvalActive ||
          input.composer.voiceRecording ||
          input.composer.voiceTranscribing
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        input.composer.toggleFocus();
        return;
      }
      if (command === "modelPicker.toggle" || command === "traitsPicker.toggle") {
        if (!composerPickerShortcutActive) return;
        event.preventDefault();
        event.stopPropagation();
        if (command === "modelPicker.toggle") input.composer.openModelPicker();
        else input.composer.openTraitsPicker();
        input.composer.scheduleFocus();
        return;
      }
      if (command === "model.next" || command === "model.previous") {
        if (!composerPickerShortcutActive) return;
        event.preventDefault();
        event.stopPropagation();
        const nextSlug = resolveCycledModelSlug({
          currentModel: input.model.selectedModel ?? "",
          options: input.model.optionsByProvider[input.model.selectedProvider] ?? [],
          favoriteSlugs: readFavoriteModelSlugs(input.model.selectedProvider),
          direction: command === "model.next" ? "next" : "previous",
        });
        if (nextSlug) input.model.select(input.model.selectedProvider, nextSlug as ModelSlug);
        return;
      }

      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (command === "terminal.toggle") {
        consume();
        input.terminal.toggleVisibility();
        return;
      }
      const split =
        command === "terminal.split" || command === "terminal.splitRight"
          ? input.terminal.splitRight
          : command === "terminal.splitLeft"
            ? input.terminal.splitLeft
            : command === "terminal.splitDown"
              ? input.terminal.splitDown
              : command === "terminal.splitUp"
                ? input.terminal.splitUp
                : null;
      if (split) {
        consume();
        if (!input.terminal.open) input.terminal.setOpen(true);
        split();
        return;
      }
      if (command === "terminal.close") {
        consume();
        if (input.terminal.open) void input.terminal.close(input.terminal.activeTerminalId);
        return;
      }
      if (command === "terminal.new") {
        consume();
        input.terminal.create();
        return;
      }
      if (command === "terminal.workspace.newFullWidth") {
        consume();
        input.terminal.openFullWidth();
        return;
      }
      if (command === "terminal.workspace.closeActive") {
        consume();
        input.terminal.closeWorkspaceView();
        return;
      }
      if (command === "terminal.workspace.terminal" || command === "terminal.workspace.chat") {
        consume();
        if (input.terminal.workspaceOpen) {
          input.terminal.setWorkspaceTab(
            command === "terminal.workspace.terminal" ? "terminal" : "chat",
          );
        }
        return;
      }
      if (command === "diff.toggle") {
        consume();
        input.panels.toggleDiff();
        return;
      }
      if (command === "browser.toggle") {
        consume();
        if (isElectron) input.panels.toggleBrowser();
        return;
      }
      if (command === "chat.split") return;

      const scriptId = projectScriptIdFromCommand(command);
      const script = input.project.active?.scripts.find((entry) => entry.id === scriptId);
      if (!scriptId || !script) return;
      consume();
      void input.project.runScript(script);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [input]);
}
