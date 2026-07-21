// FILE: useComposerSlashCommands.ts
// Purpose: Composes slash-command availability, thread actions, execution, and editor selection.
// Layer: Web composer application logic

import { useState } from "react";
import { isTemporarySidechatThread } from "../agentGroupCapabilities";
import { getAvailableComposerSlashCommands } from "../composerSlashCommands";
import type { ComposerSlashCommandsInput } from "./composer-slash/types";
import { useComposerSlashExecution } from "./composer-slash/useComposerSlashExecution";
import { useComposerSlashModeActions } from "./composer-slash/useComposerSlashModeActions";
import { useComposerSlashSelection } from "./composer-slash/useComposerSlashSelection";
import { useComposerSlashThreadActions } from "./composer-slash/useComposerSlashThreadActions";

export function useComposerSlashCommands(input: ComposerSlashCommandsInput) {
  const [isSlashStatusDialogOpen, setIsSlashStatusDialogOpen] = useState(false);
  const canCreateSidechat = Boolean(
    input.activeProject &&
    input.activeThread &&
    input.isServerThread &&
    !isTemporarySidechatThread(input.activeThread),
  );
  const availableBuiltInSlashCommands = getAvailableComposerSlashCommands({
    provider: input.selectedProvider,
    supportsFastSlashCommand: input.supportsFastSlashCommand,
    canOfferCompactCommand: input.canOfferCompactCommand,
    canOfferReviewCommand: true,
    canOfferForkCommand: true,
    canOfferSideCommand: true,
    canOfferExportCommand: input.canOfferExportCommand,
    providerNativeCommandNames: input.providerNativeCommands.map((command) => command.name),
  }).filter(
    (command) => !input.surfaceAppSlashCommands || input.surfaceAppSlashCommands.has(command),
  );

  const modeActions = useComposerSlashModeActions(input);
  const threadActions = useComposerSlashThreadActions({ ...input, canCreateSidechat });
  const handleStandaloneSlashCommand = useComposerSlashExecution({
    ...input,
    ...modeActions,
    ...threadActions,
    availableBuiltInSlashCommands,
    setIsSlashStatusDialogOpen,
  });
  const handleSlashCommandSelection = useComposerSlashSelection({
    ...input,
    ...modeActions,
    ...threadActions,
    setIsSlashStatusDialogOpen,
  });

  return {
    handleForkTargetSelection: threadActions.handleForkTargetSelection,
    handleReviewTargetSelection: threadActions.handleReviewTargetSelection,
    isSlashStatusDialogOpen,
    setIsSlashStatusDialogOpen,
    handleStandaloneSlashCommand,
    handleSlashCommandSelection,
  };
}
