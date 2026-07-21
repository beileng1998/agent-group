import type { ChatAssistantSelectionAttachment, ChatMessage } from "../types";
import {
  deriveDisplayedUserMessageState,
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import { filterPastedTextsWithText, type PastedTextDraft } from "../lib/composerPastedText";

export const PROMPT_HISTORY_MAX_ENTRIES = 100;

// Big-paste cards are sent only by the normal chat path; non-chat composer flows
// read plain editor text, so they must let Lexical insert pasted text normally.
export function shouldEnableComposerPastedTextCollapse(input: {
  isComposerApprovalState: boolean;
  hasPendingUserInput: boolean;
  showPlanFollowUpPrompt: boolean;
}): boolean {
  return (
    !input.isComposerApprovalState && !input.hasPendingUserInput && !input.showPlanFollowUpPrompt
  );
}

export function buildComposerMenuSelectionKey(input: {
  menuOpen: boolean;
  picker: string | null;
  triggerKind: string | null;
  triggerQuery: string;
  items: readonly { id: string }[];
}): string | null {
  if (!input.menuOpen) {
    return null;
  }
  const sourceKey = input.picker
    ? `picker:${input.picker}`
    : `trigger:${input.triggerKind ?? "none"}:${input.triggerQuery}`;
  return `${sourceKey}\u001f${input.items.map((item) => item.id).join("\u001e")}`;
}

export interface PromptHistoryNavigationState {
  index: number;
  draft: string;
}

export type PromptHistoryDirection = "older" | "newer";

// All cursor values in prompt history navigation are EXPANDED offsets — raw
// indices into the prompt string. Collapsed composer cursors (where inline
// token chips like mentions count as a single unit) must be expanded before
// calling in and collapsed again before being applied to composer state, or
// the line-boundary math below misfires on any prompt containing a chip.
export interface PromptHistoryNavigationResult {
  handled: boolean;
  prompt: string;
  expandedCursor: number;
  state: PromptHistoryNavigationState | null;
}

export function derivePromptHistoryFromMessages(
  messages: ReadonlyArray<Pick<ChatMessage, "role" | "source" | "text">>,
  limit: number = PROMPT_HISTORY_MAX_ENTRIES,
): string[] {
  if (limit <= 0) {
    return [];
  }
  const history: string[] = [];
  for (let index = messages.length - 1; index >= 0 && history.length < limit; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user" || (message.source ?? "native") !== "native") {
      continue;
    }
    const prompt = deriveDisplayedUserMessageState(message.text, {
      hideImageOnlyBootstrapPrompt: true,
    }).copyText.trim();
    if (prompt.length === 0) {
      continue;
    }
    history.push(prompt);
  }
  return history;
}

export function promptStillMatchesActiveHistoryBrowse(input: {
  state: PromptHistoryNavigationState | null;
  history: readonly string[];
  nextPrompt: string;
  appliedPrompt: string | null;
}): boolean {
  if (input.state === null) {
    return false;
  }
  const activeEntry = input.history[input.state.index] ?? null;
  return input.nextPrompt === activeEntry || input.nextPrompt === input.appliedPrompt;
}

export function shouldHandlePromptHistoryNavigationKey(input: {
  key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash";
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  menuIsActive: boolean;
  hasActivePendingProgress: boolean;
  isComposerApprovalState: boolean;
  pendingUserInputCount: number;
}): boolean {
  return (
    (input.key === "ArrowUp" || input.key === "ArrowDown") &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.altKey &&
    !input.shiftKey &&
    !input.menuIsActive &&
    !input.hasActivePendingProgress &&
    !input.isComposerApprovalState &&
    input.pendingUserInputCount === 0
  );
}

// `expandedCursor` is a raw index into `prompt` (see PromptHistoryNavigationResult).
export function isComposerCursorOnFirstLine(prompt: string, expandedCursor: number): boolean {
  const boundedCursor = Math.max(0, Math.min(prompt.length, expandedCursor));
  const firstLineEnd = prompt.indexOf("\n");
  return firstLineEnd < 0 || boundedCursor <= firstLineEnd;
}

// `expandedCursor` is a raw index into `prompt` (see PromptHistoryNavigationResult).
export function isComposerCursorOnLastLine(prompt: string, expandedCursor: number): boolean {
  const boundedCursor = Math.max(0, Math.min(prompt.length, expandedCursor));
  const lastLineStart = prompt.lastIndexOf("\n") + 1;
  return boundedCursor >= lastLineStart;
}

function expandedCursorForPromptHistoryItem(
  prompt: string,
  direction: PromptHistoryDirection,
): number {
  if (direction === "older") {
    const firstLineEnd = prompt.indexOf("\n");
    return firstLineEnd < 0 ? prompt.length : firstLineEnd;
  }
  return prompt.length;
}

export function resolvePromptHistoryNavigation(input: {
  direction: PromptHistoryDirection;
  history: readonly string[];
  currentPrompt: string;
  currentExpandedCursor: number;
  selectionCollapsed: boolean;
  state: PromptHistoryNavigationState | null;
}): PromptHistoryNavigationResult {
  const notHandled = (
    state: PromptHistoryNavigationState | null,
  ): PromptHistoryNavigationResult => ({
    handled: false,
    prompt: input.currentPrompt,
    expandedCursor: input.currentExpandedCursor,
    state,
  });
  if (!input.selectionCollapsed || input.history.length === 0) {
    return notHandled(input.state);
  }
  // The active history entry the composer should still be showing. When it no
  // longer matches (history changed under us or the index fell out of range),
  // the browse lost its place: never keep navigating from a bogus index, and
  // never abandon the saved draft — restart from the newest entry when going
  // older, or restore the draft when going newer.
  const activeEntry = input.state ? input.history[input.state.index] : undefined;
  const stateIsStale =
    input.state !== null && (activeEntry === undefined || input.currentPrompt !== activeEntry);

  if (input.direction === "older") {
    if (!isComposerCursorOnFirstLine(input.currentPrompt, input.currentExpandedCursor)) {
      return notHandled(input.state);
    }
    const nextState: PromptHistoryNavigationState =
      input.state === null
        ? { index: 0, draft: input.currentPrompt }
        : stateIsStale
          ? { index: 0, draft: input.state.draft }
          : {
              ...input.state,
              index: Math.min(input.state.index + 1, input.history.length - 1),
            };
    const nextPrompt = input.history[nextState.index] ?? input.currentPrompt;
    return {
      handled: true,
      prompt: nextPrompt,
      expandedCursor: expandedCursorForPromptHistoryItem(nextPrompt, "older"),
      state: nextState,
    };
  }

  if (!input.state) {
    return notHandled(null);
  }
  const cursorCanNavigateNewer =
    isComposerCursorOnLastLine(input.currentPrompt, input.currentExpandedCursor) ||
    isComposerCursorOnFirstLine(input.currentPrompt, input.currentExpandedCursor);
  if (!cursorCanNavigateNewer) {
    return notHandled(input.state);
  }
  if (stateIsStale) {
    return {
      handled: true,
      prompt: input.state.draft,
      expandedCursor: input.state.draft.length,
      state: null,
    };
  }
  if (input.state.index > 0) {
    const nextState = {
      ...input.state,
      index: input.state.index - 1,
    };
    const nextPrompt = input.history[nextState.index] ?? input.currentPrompt;
    return {
      handled: true,
      prompt: nextPrompt,
      expandedCursor: expandedCursorForPromptHistoryItem(nextPrompt, "newer"),
      state: nextState,
    };
  }

  return {
    handled: true,
    prompt: input.state.draft,
    expandedCursor: input.state.draft.length,
    state: null,
  };
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  fileCount: number;
  assistantSelectionCount: number;
  fileCommentCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  pastedTexts: ReadonlyArray<PastedTextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  sendablePastedTexts: PastedTextDraft[];
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const sendablePastedTexts = filterPastedTextsWithText(options.pastedTexts);
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    sendablePastedTexts,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      options.fileCount > 0 ||
      options.assistantSelectionCount > 0 ||
      options.fileCommentCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      sendablePastedTexts.length > 0,
  };
}

export function collectUserMessageAssistantSelections(
  message: ChatMessage,
): ChatAssistantSelectionAttachment[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  return message.attachments.filter(
    (attachment): attachment is ChatAssistantSelectionAttachment =>
      attachment.type === "assistant-selection",
  );
}
