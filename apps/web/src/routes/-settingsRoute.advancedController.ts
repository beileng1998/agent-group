import type { EditorId } from "@agent-group/contracts";
import { useCallback, useMemo, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { createAllThreadsMessagelessSelector } from "../storeSelectors";
import type { ThreadShell } from "../types";

export function useAdvancedSettingsController(input: {
  keybindingsConfigPath: string | null;
  availableEditors: ReadonlyArray<EditorId> | undefined;
  threadShells: ReadonlyArray<ThreadShell>;
}) {
  const projects = useStore((store) => store.projects);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const allThreadsMessageless = useStore(useMemo(() => createAllThreadsMessagelessSelector(), []));
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [isRepairingLocalState, setIsRepairingLocalState] = useState(false);
  const [showRecoveryTools, setShowRecoveryTools] = useState(false);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [openSourceLicensesOpen, setOpenSourceLicensesOpen] = useState(false);

  const shouldOfferRecoveryTools = useMemo(() => {
    if (!threadsHydrated || projects.length === 0) return false;
    return input.threadShells.length === 0 || allThreadsMessageless;
  }, [allThreadsMessageless, input.threadShells.length, projects.length, threadsHydrated]);

  const openKeybindingsFile = useCallback(() => {
    if (!input.keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const editor = resolveAndPersistPreferredEditor(input.availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void ensureNativeApi()
      .shell.openInEditor(input.keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => setIsOpeningKeybindings(false));
  }, [input.availableEditors, input.keybindingsConfigPath]);

  const repairLocalState = useCallback(async () => {
    if (isRepairingLocalState) return;
    const api = ensureNativeApi();
    const confirmed = await api.dialogs.confirm(
      [
        "Repair local state?",
        "This rebuilds local project indexes and refreshes project snapshots.",
        "It keeps existing chats in place, but it may take a moment.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setIsRepairingLocalState(true);
    try {
      const snapshot = await api.orchestration.repairState();
      syncServerReadModel(snapshot);
      toastManager.add({
        type: "success",
        title: "Local state repaired",
        description: "Project indexes were rebuilt without clearing existing chats.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Repair failed",
        description: error instanceof Error ? error.message : "Unable to repair local state.",
      });
    } finally {
      setIsRepairingLocalState(false);
    }
  }, [isRepairingLocalState, syncServerReadModel]);

  const resetUi = useCallback(() => {
    setShowRecoveryTools(false);
    setOpenKeybindingsError(null);
  }, []);

  return {
    isOpeningKeybindings,
    openKeybindingsError,
    openKeybindingsFile,
    shouldOfferRecoveryTools,
    isRepairingLocalState,
    repairLocalState,
    showRecoveryTools,
    toggleRecoveryTools: () => setShowRecoveryTools((open) => !open),
    releaseHistoryOpen,
    setReleaseHistoryOpen,
    openReleaseHistory: () => setReleaseHistoryOpen(true),
    openSourceLicensesOpen,
    setOpenSourceLicensesOpen,
    openSourceLicenses: () => setOpenSourceLicensesOpen(true),
    resetUi,
  };
}
