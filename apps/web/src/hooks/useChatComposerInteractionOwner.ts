// FILE: useChatComposerInteractionOwner.ts
// Purpose: Compose the editor, attachments, voice, provider, and layout controllers for chat.
// Layer: Web chat composer owner

import { useRef, useState } from "react";

import { useComposerVoiceController } from "../components/chat/useComposerVoiceController";
import { useChatProviderAvailabilityController } from "./useChatProviderAvailabilityController";
import { useComposerDraftReferencesController } from "./useComposerDraftReferencesController";
import { useComposerFocusController } from "./useComposerFocusController";
import { useComposerPromptMutationController } from "./useComposerPromptMutationController";

type AvailabilityInput = Parameters<typeof useChatProviderAvailabilityController>[0];
type FocusInput = Parameters<typeof useComposerFocusController>[0];
type PromptMutationInput = Parameters<typeof useComposerPromptMutationController>[0];
type VoiceInput = Parameters<typeof useComposerVoiceController>[0];
type ReferencesInput = Parameters<typeof useComposerDraftReferencesController>[0];
export interface ChatComposerInteractionOwnerInput {
  readonly provider: {
    readonly availability: AvailabilityInput;
  };
  readonly composer: {
    readonly focus: FocusInput;
    readonly promptMutation: Omit<PromptMutationInput, "focus">;
    readonly voice: Omit<
      VoiceInput,
      "activeProviderStatus" | "onTranscriptReady" | "refreshVoiceStatus"
    >;
    readonly references: Omit<
      ReferencesInput,
      "editorRef" | "focusComposer" | "dragDepthRef" | "setIsDragOverComposer"
    >;
  };
}

export function useChatComposerInteractionOwner(input: ChatComposerInteractionOwnerInput) {
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const dragDepthRef = useRef(0);

  const availability = useChatProviderAvailabilityController(input.provider.availability);
  const focus = useComposerFocusController(input.composer.focus);
  const promptMutation = useComposerPromptMutationController({
    ...input.composer.promptMutation,
    focus: focus.schedule,
  });
  const voice = useComposerVoiceController({
    ...input.composer.voice,
    activeProviderStatus: availability.voiceProviderStatus,
    onTranscriptReady: promptMutation.appendVoiceTranscript,
    refreshVoiceStatus: availability.refreshProviderStatuses,
  });
  const references = useComposerDraftReferencesController({
    ...input.composer.references,
    editorRef: focus.editorRef,
    dragDepthRef,
    focusComposer: focus.focus,
    setIsDragOverComposer,
  });
  return {
    availability,
    focus,
    promptMutation,
    voice,
    references,
    drag: { isDragOverComposer, setIsDragOverComposer, dragDepthRef },
  };
}
