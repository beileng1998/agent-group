// FILE: useComposerSlashModeActions.ts
// Purpose: Owns compact, fast-mode, export, and provider capability slash actions.
// Layer: Web composer application logic

import { useCallback } from "react";
import { toastManager } from "../../components/ui/toast";
import {
  parseFastSlashCommandAction,
  hasProviderNativeSlashCommand,
} from "../../composerSlashCommands";
import { downloadUrlAsBlob } from "../../lib/browserDownload";
import { resolveWsHttpUrl } from "../../lib/wsHttpUrl";
import { readNativeApi } from "../../nativeApi";
import { buildNextProviderOptions } from "../../providerModelOptions";
import type { ComposerSlashCommandsInput } from "./types";

type Input = Pick<
  ComposerSlashCommandsInput,
  | "activeThread"
  | "canOfferCompactCommand"
  | "canOfferExportCommand"
  | "currentProviderModelOptions"
  | "editorActions"
  | "fastModeEnabled"
  | "isServerThread"
  | "providerCommandDiscoveryCwd"
  | "selectedProvider"
  | "setComposerDraftProviderModelOptions"
  | "supportsFastSlashCommand"
  | "threadId"
>;

export function useComposerSlashModeActions(input: Input) {
  const compactProviderThread = useCallback(async (): Promise<boolean> => {
    const api = readNativeApi();
    if (
      !api ||
      !input.canOfferCompactCommand ||
      !input.isServerThread ||
      !input.activeThread?.session ||
      input.activeThread.session.status === "closed"
    ) {
      toastManager.add({
        type: "warning",
        title: "Compact is unavailable",
        description: "Open an active supported server thread before compacting context.",
      });
      return false;
    }

    try {
      void api.provider.compactThread({ threadId: input.activeThread.id }).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not compact thread",
          description:
            error instanceof Error ? error.message : "An error occurred while compacting context.",
        });
      });
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not compact thread",
        description:
          error instanceof Error ? error.message : "An error occurred while compacting context.",
      });
      return false;
    }
  }, [input.activeThread, input.canOfferCompactCommand, input.isServerThread]);

  const setFastModeFromSlashCommand = useCallback(
    (enabled: boolean) => {
      input.setComposerDraftProviderModelOptions(
        input.threadId,
        input.selectedProvider,
        buildNextProviderOptions(input.selectedProvider, input.currentProviderModelOptions, {
          fastMode: enabled,
        }),
        { persistSticky: true },
      );
    },
    [
      input.currentProviderModelOptions,
      input.selectedProvider,
      input.setComposerDraftProviderModelOptions,
      input.threadId,
    ],
  );

  const runFastSlashCommand = useCallback(
    (text: string) => {
      const action = parseFastSlashCommandAction(text);
      if (action === null) return false;
      if (!input.supportsFastSlashCommand) {
        toastManager.add({
          type: "warning",
          title: "Fast mode is unavailable",
          description: "The selected model does not support Fast mode.",
        });
        return true;
      }
      if (action === "invalid") {
        toastManager.add({
          type: "warning",
          title: "Invalid /fast command",
          description: "Use /fast, /fast on, /fast off, or /fast status.",
        });
        return true;
      }
      if (action === "status") {
        toastManager.add({
          type: "info",
          title: `Fast mode is ${input.fastModeEnabled ? "on" : "off"}`,
        });
        return true;
      }
      const enabled = action === "on" ? true : action === "off" ? false : !input.fastModeEnabled;
      setFastModeFromSlashCommand(enabled);
      toastManager.add({ type: "success", title: `Fast mode ${enabled ? "enabled" : "disabled"}` });
      return true;
    },
    [input.fastModeEnabled, input.supportsFastSlashCommand, setFastModeFromSlashCommand],
  );

  const checkClaudeFastSlashCommandAvailability = useCallback(async (): Promise<boolean> => {
    const api = readNativeApi();
    if (!api || !input.providerCommandDiscoveryCwd) {
      input.editorActions.clearComposerSlashDraft();
      toastManager.add({
        type: "warning",
        title: "Fast mode could not be checked",
        description: "Claude command discovery is unavailable right now.",
      });
      return false;
    }
    try {
      const result = await api.provider.listCommands({
        provider: "claudeAgent",
        cwd: input.providerCommandDiscoveryCwd,
        threadId: input.threadId,
        forceReload: true,
      });
      if (
        hasProviderNativeSlashCommand(
          "claudeAgent",
          result.commands.map((command) => command.name),
          "fast",
        )
      ) {
        return true;
      }
    } catch {
      input.editorActions.clearComposerSlashDraft();
      toastManager.add({
        type: "warning",
        title: "Fast mode could not be checked",
        description: "Claude command discovery failed. Please try again.",
      });
      return false;
    }
    input.editorActions.clearComposerSlashDraft();
    toastManager.add({
      type: "info",
      title: "Fast mode is unavailable",
      description: "Claude did not expose /fast for this account or environment.",
    });
    return false;
  }, [input.editorActions, input.providerCommandDiscoveryCwd, input.threadId]);

  const runExportSlashCommand = useCallback(() => {
    if (!input.canOfferExportCommand) {
      toastManager.add({
        type: "warning",
        title: "Export is unavailable",
        description:
          "Open a server-backed thread and wait for the current turn to finish before exporting.",
      });
      return;
    }
    const params = new URLSearchParams({ threadId: input.threadId });
    void downloadUrlAsBlob({
      url: resolveWsHttpUrl(`/api/thread-export?${params.toString()}`),
      filename: `agent-group-thread-${input.threadId}.zip`,
    }).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not export thread",
        description:
          error instanceof Error ? error.message : "An error occurred while exporting the thread.",
      });
    });
  }, [input.canOfferExportCommand, input.threadId]);

  return {
    checkClaudeFastSlashCommandAvailability,
    compactProviderThread,
    runExportSlashCommand,
    runFastSlashCommand,
  };
}
