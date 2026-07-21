// FILE: useComposerSlashSelection.ts
// Purpose: Applies slash-menu selections to the composer and routes immediate actions.
// Layer: Web composer application logic

import type { ProviderKind } from "@agent-group/contracts";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { ComposerCommandItem } from "../../components/chat/ComposerCommandMenu";
import { toastManager } from "../../components/ui/toast";
import { extendReplacementRangeForTrailingSpace } from "../../composerTriggerInsertion";
import { buildSubagentsPrompt } from "../../composerSlashCommands";
import type { SidechatCreatorOptions } from "../../lib/sidechatCreatorRegistry";
import type { ComposerSlashEditorActions } from "./types";

type SlashCommandItem = Extract<ComposerCommandItem, { type: "slash-command" }>;

type Input = {
  compactProviderThread: () => Promise<boolean>;
  createSidechatFromSlashCommand: (options?: SidechatCreatorOptions) => Promise<boolean>;
  editorActions: ComposerSlashEditorActions;
  handleClearConversation: () => Promise<void> | void;
  handleInteractionModeChange: (mode: "default" | "plan") => Promise<void> | void;
  openForkTargetPicker: () => void;
  openReviewTargetPicker: () => void;
  runExportSlashCommand: () => void;
  runFastSlashCommand: (text: string) => boolean;
  selectedProvider: ProviderKind;
  setIsSlashStatusDialogOpen: Dispatch<SetStateAction<boolean>>;
  supportsTextNativeReviewCommand: boolean;
};

function wasPromptReplacementApplied(result: number | false): boolean {
  return result !== false;
}

export function useComposerSlashSelection(input: Input) {
  return useCallback(
    (item: SlashCommandItem) => {
      const { snapshot, trigger } = input.editorActions.resolveActiveComposerTrigger();
      if (!trigger) return;

      if (item.command === "model" || item.command === "automation") {
        const replacement = item.command === "model" ? "/model " : "/automation ";
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = input.editorActions.applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (wasPromptReplacementApplied(applied)) {
          input.editorActions.setComposerHighlightedItemId(null);
          if (item.command === "automation") input.editorActions.scheduleComposerFocus();
        }
        return;
      }

      const clearSlashCommandFromComposer = () =>
        input.editorActions.applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });

      if (item.command === "clear") {
        if (wasPromptReplacementApplied(clearSlashCommandFromComposer())) {
          input.editorActions.setComposerHighlightedItemId(null);
        }
        void input.handleClearConversation();
        return;
      }
      if (item.command === "compact") {
        if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
        input.editorActions.setComposerHighlightedItemId(null);
        void input.compactProviderThread();
        input.editorActions.scheduleComposerFocus();
        return;
      }
      if (item.command === "plan" || item.command === "default") {
        void input.handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        if (wasPromptReplacementApplied(clearSlashCommandFromComposer())) {
          input.editorActions.setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.command === "subagents") {
        const applied = input.editorActions.applyPromptReplacement(
          trigger.rangeStart,
          trigger.rangeEnd,
          buildSubagentsPrompt(""),
          { expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd) },
        );
        if (wasPromptReplacementApplied(applied)) {
          input.editorActions.setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.command === "status") {
        if (wasPromptReplacementApplied(clearSlashCommandFromComposer())) {
          input.editorActions.setComposerHighlightedItemId(null);
          input.setIsSlashStatusDialogOpen(true);
          input.editorActions.scheduleComposerFocus();
        }
        return;
      }
      if (item.command === "fast" || item.command === "export") {
        if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
        input.editorActions.setComposerHighlightedItemId(null);
        if (item.command === "fast") input.runFastSlashCommand("/fast");
        else input.runExportSlashCommand();
        input.editorActions.scheduleComposerFocus();
        return;
      }
      if (item.command === "review") {
        if (input.selectedProvider === "codex") {
          if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
          input.editorActions.setComposerHighlightedItemId(null);
          input.openReviewTargetPicker();
          input.editorActions.scheduleComposerFocus();
          return;
        }
        if (input.supportsTextNativeReviewCommand) {
          const replacement = "/review";
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = input.editorActions.applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (wasPromptReplacementApplied(applied)) {
            input.editorActions.setComposerHighlightedItemId(null);
          }
          return;
        }
        if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
        input.editorActions.setComposerHighlightedItemId(null);
        input.openReviewTargetPicker();
        input.editorActions.scheduleComposerFocus();
        return;
      }
      if (item.command === "fork") {
        if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
        input.editorActions.setComposerHighlightedItemId(null);
        input.openForkTargetPicker();
        input.editorActions.scheduleComposerFocus();
        return;
      }
      if (item.command === "side") {
        if (!wasPromptReplacementApplied(clearSlashCommandFromComposer())) return;
        input.editorActions.setComposerHighlightedItemId(null);
        void input.createSidechatFromSlashCommand().catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start Side",
            description:
              error instanceof Error ? error.message : "An error occurred while creating Side.",
          });
        });
      }
    },
    [
      input.compactProviderThread,
      input.createSidechatFromSlashCommand,
      input.editorActions,
      input.handleClearConversation,
      input.handleInteractionModeChange,
      input.openForkTargetPicker,
      input.openReviewTargetPicker,
      input.runExportSlashCommand,
      input.runFastSlashCommand,
      input.selectedProvider,
      input.setIsSlashStatusDialogOpen,
      input.supportsTextNativeReviewCommand,
    ],
  );
}
