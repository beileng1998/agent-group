import type { ProviderInteractionMode, RuntimeMode } from "@agent-group/contracts";
import { useCallback, useState } from "react";

import type { DraftThreadEnvMode } from "~/composerDraftStore";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";

export function useKanbanNewTaskDialogFormState(initialSendAsDraft: boolean) {
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [interactionMode, setInteractionMode] =
    useState<ProviderInteractionMode>(DEFAULT_INTERACTION_MODE);
  const [envMode, setEnvMode] = useState<DraftThreadEnvMode>("local");
  // Off by default: a new task is sent straight to In Progress (like starting a
  // fresh chat). The Draft column's "+" opens the dialog with the toggle on, so
  // the task parks in Draft — matching where the user clicked.
  const [sendAsDraft, setSendAsDraft] = useState(initialSendAsDraft);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isTraitsPickerOpen, setIsTraitsPickerOpen] = useState(false);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);
  const navigateExpandedImage = useCallback((direction: -1 | 1) => {
    setExpandedImage((existing) => {
      if (!existing || existing.images.length <= 1) {
        return existing;
      }
      return {
        ...existing,
        index: (existing.index + direction + existing.images.length) % existing.images.length,
      };
    });
  }, []);

  return {
    runtimeMode,
    setRuntimeMode,
    interactionMode,
    setInteractionMode,
    envMode,
    setEnvMode,
    sendAsDraft,
    setSendAsDraft,
    isModelPickerOpen,
    setIsModelPickerOpen,
    isTraitsPickerOpen,
    setIsTraitsPickerOpen,
    isDragOverComposer,
    setIsDragOverComposer,
    expandedImage,
    setExpandedImage,
    closeExpandedImage,
    navigateExpandedImage,
  };
}
