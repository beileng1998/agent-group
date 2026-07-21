import type {
  MessageId,
  OrchestrationThreadActivity,
  PinnedMessage,
  ProviderMentionReference,
  ProviderPluginDescriptor,
  ThreadMarker,
} from "@agent-group/contracts";

import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftStore";
import { formatAssistantSelectionQueuePreview } from "../../lib/assistantSelections";
import { formatFileCommentLabel, type FileCommentDraft } from "../../lib/fileComments";
import { formatPastedTextTitleSeed, type PastedTextDraft } from "../../lib/composerPastedText";
import { formatTerminalContextLabel, type TerminalContextDraft } from "../../lib/terminalContext";
import type { ChatMessage } from "../../types";

export const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
export const EMPTY_MESSAGES: ChatMessage[] = [];
export const EMPTY_PINNED_MESSAGES: readonly PinnedMessage[] = [];
export const EMPTY_THREAD_MARKERS: readonly ThreadMarker[] = [];
export const EMPTY_PINNED_TEXT: ReadonlyMap<MessageId, string> = new Map();
export const EMPTY_REVERT_TURN_COUNTS: Map<MessageId, number> = new Map();
export const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

export type ComposerPluginSuggestion = {
  plugin: ProviderPluginDescriptor;
  mention: ProviderMentionReference;
};

export const EMPTY_COMPOSER_PLUGIN_SUGGESTIONS: ComposerPluginSuggestion[] = [];
export const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
export const VOICE_RECORDER_ACTION_ARM_DELAY_MS = 250;

export { formatPastedTextTitleSeed };

export function eventTargetsComposer(
  event: globalThis.KeyboardEvent,
  composerForm: HTMLFormElement | null,
): boolean {
  if (!composerForm) return false;
  const target = event.target;
  return target instanceof Node ? composerForm.contains(target) : false;
}

export function canHandleComposerPickerShortcut(
  event: globalThis.KeyboardEvent,
  composerForm: HTMLFormElement | null,
): boolean {
  if (!composerForm) return false;
  if (eventTargetsComposer(event, composerForm)) return true;
  const target = event.target;
  return (
    target === document.body ||
    target === document.documentElement ||
    document.activeElement === document.body ||
    document.activeElement === document.documentElement
  );
}

export function buildQueuedComposerPreviewText(input: {
  trimmedPrompt: string;
  images: ReadonlyArray<ComposerImageAttachment>;
  files: ReadonlyArray<ComposerFileAttachment>;
  assistantSelections: ReadonlyArray<{ id: string }>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  fileComments: ReadonlyArray<FileCommentDraft>;
  pastedTexts: ReadonlyArray<PastedTextDraft>;
}): string {
  if (input.trimmedPrompt.length > 0) {
    return input.trimmedPrompt;
  }
  const firstImage = input.images[0];
  if (firstImage) {
    return `Image: ${firstImage.name}`;
  }
  const firstFile = input.files[0];
  if (firstFile) {
    return `File: ${firstFile.name}`;
  }
  if (input.assistantSelections.length > 0) {
    return formatAssistantSelectionQueuePreview(input.assistantSelections.length);
  }
  const firstTerminalContext = input.terminalContexts[0];
  if (firstTerminalContext) {
    return formatTerminalContextLabel(firstTerminalContext);
  }
  const firstFileComment = input.fileComments[0];
  if (firstFileComment) {
    return formatFileCommentLabel(firstFileComment);
  }
  const pastedTitle = formatPastedTextTitleSeed(input.pastedTexts);
  if (pastedTitle) {
    return pastedTitle;
  }
  return "Queued follow-up";
}

export function warnVoiceGuard(event: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }
  if (details) {
    console.warn(`[voice] ${event}`, details);
    return;
  }
  console.warn(`[voice] ${event}`);
}

export const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

export const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);
