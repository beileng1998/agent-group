// FILE: useComposerCommandKeyController.ts
// Purpose: Arbitrate composer keyboard commands in their product-defined priority order.
// Layer: Web composer controller

import { useCallback, type MutableRefObject } from "react";

import type { ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import type { ComposerLocalDirectoryMenuHandle } from "../components/chat/ComposerLocalDirectoryMenu";
import type { ComposerTrigger } from "../composer-logic";
import { extractChatAutomationInvocation } from "../lib/automationIntent";

export type ComposerCommandKey = "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash";

type ComposerEditorSnapshot = ReturnType<ComposerPromptEditorHandle["readSnapshot"]>;

interface PromptHistoryKeyRequest {
  key: ComposerCommandKey;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  menuIsActive: boolean;
  hasActivePendingProgress: boolean;
  isComposerApprovalState: boolean;
  pendingUserInputCount: number;
  currentPrompt: string;
  currentExpandedCursor: number;
  selectionCollapsed: boolean;
}

export function useComposerCommandKeyController(input: {
  resolveTrigger: () => {
    snapshot: ComposerEditorSnapshot;
    trigger: ComposerTrigger | null;
  };
  menuOpenRef: MutableRefObject<boolean>;
  menuItemsRef: MutableRefObject<ComposerCommandItem[]>;
  activeMenuItemRef: MutableRefObject<ComposerCommandItem | null>;
  localDirectoryMenuRef: MutableRefObject<ComposerLocalDirectoryMenuHandle | null>;
  localFolderBrowserOpen: boolean;
  hasActivePendingProgress: boolean;
  isComposerApprovalState: boolean;
  pendingUserInputCount: number;
  clearSlashDraft: () => void;
  toggleInteractionMode: () => void;
  nudgeMenuHighlight: (key: "ArrowDown" | "ArrowUp") => void;
  selectMenuItem: (item: ComposerCommandItem) => void;
  handlePromptHistoryKey: (request: PromptHistoryKeyRequest) => boolean;
  commitRecalledPrompt: () => void;
  send: (mode: "queue" | "steer") => unknown;
}) {
  return useCallback(
    (key: ComposerCommandKey, event: KeyboardEvent): boolean => {
      if (key === "Slash" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const { snapshot, trigger } = input.resolveTrigger();
        const slashTriggerText =
          trigger && (trigger.kind === "slash-command" || trigger.kind === "slash-model")
            ? snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd)
            : null;
        if (slashTriggerText === "/" && snapshot.expandedCursor === trigger?.rangeEnd) {
          if (trigger.rangeStart === 0 && trigger.rangeEnd === snapshot.value.length) {
            input.clearSlashDraft();
            return true;
          }
          return false;
        }
        return false;
      }

      if (key === "Tab" && event.shiftKey) {
        input.toggleInteractionMode();
        return true;
      }

      const { snapshot, trigger } = input.resolveTrigger();
      const menuIsActive = input.menuOpenRef.current || trigger !== null;
      if (
        key === "Enter" &&
        !event.shiftKey &&
        !menuIsActive &&
        extractChatAutomationInvocation(snapshot.value) !== null
      ) {
        void input.send(event.metaKey || event.ctrlKey ? "steer" : "queue");
        return true;
      }

      if (menuIsActive && input.localFolderBrowserOpen) {
        if (key === "ArrowDown") {
          input.localDirectoryMenuRef.current?.moveHighlight("down");
          return true;
        }
        if (key === "ArrowUp") {
          input.localDirectoryMenuRef.current?.moveHighlight("up");
          return true;
        }
        if (key === "Enter" || key === "Tab") {
          input.localDirectoryMenuRef.current?.activateHighlighted();
          return true;
        }
      }

      if (menuIsActive) {
        const currentItems = input.menuItemsRef.current;
        if (key === "ArrowDown" && currentItems.length > 0) {
          input.nudgeMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp" && currentItems.length > 0) {
          input.nudgeMenuHighlight("ArrowUp");
          return true;
        }
        if (key === "Tab" || key === "Enter") {
          const selectedItem = input.activeMenuItemRef.current ?? currentItems[0];
          if (selectedItem) {
            input.selectMenuItem(selectedItem);
            return true;
          }
        }
      }

      if (
        input.handlePromptHistoryKey({
          key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          menuIsActive,
          hasActivePendingProgress: input.hasActivePendingProgress,
          isComposerApprovalState: input.isComposerApprovalState,
          pendingUserInputCount: input.pendingUserInputCount,
          currentPrompt: snapshot.value,
          currentExpandedCursor: snapshot.expandedCursor,
          selectionCollapsed: snapshot.selectionCollapsed,
        })
      ) {
        return true;
      }

      if (key === "Enter" && !event.shiftKey) {
        input.commitRecalledPrompt();
        void input.send(event.metaKey || event.ctrlKey ? "steer" : "queue");
        return true;
      }
      return false;
    },
    [input],
  );
}
