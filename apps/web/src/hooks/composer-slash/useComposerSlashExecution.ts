// FILE: useComposerSlashExecution.ts
// Purpose: Interprets submitted standalone slash commands and routes their actions.
// Layer: Web composer application logic

import type { ProviderKind } from "@agent-group/contracts";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toastManager } from "../../components/ui/toast";
import {
  buildSlashReviewComposerPrompt,
  buildSubagentsPrompt,
  parseComposerSlashInvocationForCommands,
  parseFastSlashCommandAction,
  parseForkSlashCommandArgs,
  type ComposerSlashCommand,
  type ForkSlashCommandTarget,
} from "../../composerSlashCommands";
import type { SidechatCreatorOptions } from "../../lib/sidechatCreatorRegistry";
import type { ComposerSlashEditorActions } from "./types";

type Input = {
  availableBuiltInSlashCommands: readonly ComposerSlashCommand[];
  checkClaudeFastSlashCommandAvailability: () => Promise<boolean>;
  compactProviderThread: () => Promise<boolean>;
  createForkThreadFromSlashCommand: (options?: {
    target?: ForkSlashCommandTarget;
  }) => Promise<boolean>;
  createSidechatFromSlashCommand: (options?: SidechatCreatorOptions) => Promise<boolean>;
  editorActions: ComposerSlashEditorActions;
  handleClearConversation: () => Promise<void> | void;
  handleInteractionModeChange: (mode: "default" | "plan") => Promise<void> | void;
  openForkTargetPicker: () => void;
  openReviewTargetPicker: () => void;
  runCodexReviewStart: (target: "changes" | "base-branch") => Promise<boolean>;
  runExportSlashCommand: () => void;
  runFastSlashCommand: (text: string) => boolean;
  selectedProvider: ProviderKind;
  setIsSlashStatusDialogOpen: Dispatch<SetStateAction<boolean>>;
  supportsTextNativeReviewCommand: boolean;
};

export function useComposerSlashExecution(input: Input) {
  return useCallback(
    async (trimmed: string): Promise<boolean> => {
      const fastSlashAction = parseFastSlashCommandAction(trimmed);
      if (input.selectedProvider === "claudeAgent" && fastSlashAction !== null) {
        if (await input.checkClaudeFastSlashCommandAvailability()) return false;
        return true;
      }

      const invocation = parseComposerSlashInvocationForCommands(
        trimmed,
        input.availableBuiltInSlashCommands,
      );
      if (!invocation || invocation.command === "model") return false;
      if (invocation.command === "clear") {
        input.editorActions.clearComposerSlashDraft();
        await input.handleClearConversation();
        return true;
      }
      if (invocation.command === "compact") {
        input.editorActions.clearComposerSlashDraft();
        await input.compactProviderThread();
        return true;
      }
      if (invocation.command === "plan" || invocation.command === "default") {
        await input.handleInteractionModeChange(invocation.command === "plan" ? "plan" : "default");
        input.editorActions.clearComposerSlashDraft();
        return true;
      }
      if (invocation.command === "status") {
        input.editorActions.clearComposerSlashDraft();
        input.setIsSlashStatusDialogOpen(true);
        return true;
      }
      if (invocation.command === "subagents") {
        input.editorActions.setComposerPromptValue(buildSubagentsPrompt(invocation.args));
        return true;
      }
      if (invocation.command === "export") {
        input.editorActions.clearComposerSlashDraft();
        input.runExportSlashCommand();
        return true;
      }
      if (invocation.command === "review") {
        if (input.selectedProvider === "codex") {
          const normalizedArgs = invocation.args.trim().toLowerCase();
          if (normalizedArgs.length === 0) {
            input.editorActions.clearComposerSlashDraft();
            input.openReviewTargetPicker();
            return true;
          }
          const target =
            normalizedArgs === "base" || normalizedArgs.startsWith("base ") ? "base-branch" : null;
          if (!target) {
            toastManager.add({
              type: "warning",
              title: "Invalid /review command",
              description: "Use /review and then choose a review target.",
            });
            return true;
          }
          input.editorActions.clearComposerSlashDraft();
          await input.runCodexReviewStart(target);
          return true;
        }
        if (input.supportsTextNativeReviewCommand && invocation.args.length === 0) return false;
        if (invocation.args.length === 0) {
          input.editorActions.clearComposerSlashDraft();
          input.openReviewTargetPicker();
          return true;
        }
        input.editorActions.setComposerPromptValue(buildSlashReviewComposerPrompt(invocation.args));
        return true;
      }
      if (invocation.command === "fast") {
        input.editorActions.clearComposerSlashDraft();
        input.runFastSlashCommand(trimmed);
        return true;
      }
      if (invocation.command === "fork") {
        const { target, invalid } = parseForkSlashCommandArgs(invocation.args);
        if (invalid) {
          toastManager.add({
            type: "warning",
            title: "Invalid /fork command",
            description: "Use /fork and then choose Local or New Worktree.",
          });
          return true;
        }
        try {
          if (!target) {
            input.editorActions.clearComposerSlashDraft();
            input.openForkTargetPicker();
            return true;
          }
          await input.createForkThreadFromSlashCommand({ target });
          input.editorActions.clearComposerSlashDraft();
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Could not fork thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while creating the forked thread.",
          });
        }
        return true;
      }
      if (invocation.command === "side") {
        try {
          input.editorActions.clearComposerSlashDraft();
          await input.createSidechatFromSlashCommand({ initialPrompt: invocation.args });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Could not start Side",
            description:
              error instanceof Error ? error.message : "An error occurred while creating Side.",
          });
        }
        return true;
      }
      return false;
    },
    [
      input.availableBuiltInSlashCommands,
      input.checkClaudeFastSlashCommandAvailability,
      input.compactProviderThread,
      input.createForkThreadFromSlashCommand,
      input.createSidechatFromSlashCommand,
      input.editorActions,
      input.handleClearConversation,
      input.handleInteractionModeChange,
      input.openForkTargetPicker,
      input.openReviewTargetPicker,
      input.runCodexReviewStart,
      input.runExportSlashCommand,
      input.runFastSlashCommand,
      input.selectedProvider,
      input.setIsSlashStatusDialogOpen,
      input.supportsTextNativeReviewCommand,
    ],
  );
}
