// FILE: useChatComposerControlsOwner.ts
// Purpose: Compose timeline-aware layout, provider selection, and model controls.
// Layer: Web chat composer owner

import { useComposerLayoutController } from "../components/chat/useComposerLayoutController";
import { useEffect } from "react";
import { useChatComposerModelControlsOwner } from "./useChatComposerModelControlsOwner";
import { useComposerProviderModelSelection } from "./useComposerProviderModelSelection";

type LayoutInput = Parameters<typeof useComposerLayoutController>[0];
type ProviderSelectionInput = Parameters<typeof useComposerProviderModelSelection>[0];
type ModelControlsInput = Parameters<typeof useChatComposerModelControlsOwner>[0];

interface ComposerModelControlsInput {
  readonly provider: Omit<ModelControlsInput["provider"], "statuses">;
  readonly runtime: ModelControlsInput["runtime"];
  readonly layout: Omit<ModelControlsInput["layout"], "footerTier" | "compact">;
  readonly actions: Omit<
    ModelControlsInput["actions"],
    "focus" | "resetFooterLayout" | "onProviderModelSelect" | "setPromptFromTraits"
  >;
}

export interface ChatComposerControlsOwnerInput {
  readonly layout: Omit<LayoutInput, "composerFormRef">;
  readonly provider: {
    readonly availability: ReturnType<
      typeof import("./useChatProviderAvailabilityController").useChatProviderAvailabilityController
    >;
    readonly selection: Omit<ProviderSelectionInput, "focus">;
    readonly modelControls: ComposerModelControlsInput;
  };
  readonly composer: {
    readonly formRef: LayoutInput["composerFormRef"];
    readonly focus: () => void;
    readonly setPromptFromTraits: ModelControlsInput["actions"]["setPromptFromTraits"];
  };
  readonly threadReset: {
    readonly threadId: LayoutInput["activeThreadId"];
    readonly resetLocalDispatch: () => void;
    readonly closeExpandedImage: () => void;
    readonly dragDepthRef: { current: number };
    readonly setIsDragOverComposer: (active: boolean) => void;
  };
}

export function useChatComposerControlsOwner(input: ChatComposerControlsOwnerInput) {
  const layout = useComposerLayoutController({
    ...input.layout,
    composerFormRef: input.composer.formRef,
  });
  useEffect(() => {
    input.threadReset.resetLocalDispatch();
    input.threadReset.dragDepthRef.current = 0;
    input.threadReset.setIsDragOverComposer(false);
    input.threadReset.closeExpandedImage();
  }, [
    input.threadReset.closeExpandedImage,
    input.threadReset.dragDepthRef,
    input.threadReset.resetLocalDispatch,
    input.threadReset.setIsDragOverComposer,
    input.threadReset.threadId,
  ]);
  const providerSelection = useComposerProviderModelSelection({
    ...input.provider.selection,
    focus: input.composer.focus,
  });
  const modelControls = useChatComposerModelControlsOwner({
    provider: {
      ...input.provider.modelControls.provider,
      statuses: input.provider.availability.providerStatuses,
    },
    runtime: input.provider.modelControls.runtime,
    layout: {
      ...input.provider.modelControls.layout,
      footerTier: layout.footerTier,
      compact: layout.isFooterCompact,
    },
    actions: {
      ...input.provider.modelControls.actions,
      focus: input.composer.focus,
      resetFooterLayout: layout.resetFooterLayout,
      onProviderModelSelect: providerSelection,
      setPromptFromTraits: input.composer.setPromptFromTraits,
    },
  });

  return { layout, providerSelection, modelControls };
}

export type ChatComposerControlsOwner = ReturnType<typeof useChatComposerControlsOwner>;
