import type { MessageMentionReference } from "@agent-group/contracts";
import type { ClipboardEventHandler, Ref } from "react";

import type { TerminalContextDraft } from "~/lib/terminalContext";

export type ComposerCommandKey = "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash";

export interface ComposerPromptSnapshot {
  value: string;
  cursor: number;
  expandedCursor: number;
  selectionCollapsed: boolean;
  terminalContextIds: string[];
}

export interface ComposerPromptEditorHandle {
  blur: () => void;
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  isFocused: () => boolean;
  readSnapshot: () => ComposerPromptSnapshot;
}

export interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  mentionReferences?: ReadonlyArray<MessageMentionReference>;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onRemoveTerminalContext: (contextId: string) => void;
  /**
   * Invoked when a sufficiently large text paste should collapse into an attachment
   * card instead of inserting raw text. When omitted, pastes insert as text.
   */
  onCollapsePastedText?: (text: string) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
  ) => void;
  onCommandKeyDown?: (key: ComposerCommandKey, event: KeyboardEvent) => boolean;
  onPaste: ClipboardEventHandler<HTMLElement>;
}

export interface ComposerPromptEditorInnerProps extends ComposerPromptEditorProps {
  editorRef: Ref<ComposerPromptEditorHandle>;
}
