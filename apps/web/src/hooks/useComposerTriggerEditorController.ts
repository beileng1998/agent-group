// FILE: useComposerTriggerEditorController.ts
// Purpose: Own trigger-aware composer text replacement and editor focus behavior.
// Layer: Web composer controller

import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useMemo, type MutableRefObject } from "react";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
  type ComposerTrigger,
} from "../composer-logic";
import {
  ensureLeadingSpaceForReplacement,
  extendReplacementRangeForTrailingSpace,
} from "../composerTriggerInsertion";
import {
  composerMentionPathNeedsQuoting,
  formatComposerMentionToken,
} from "../lib/composerMentions";

interface ComposerEditorRefValue {
  focusAt(cursor: number): void;
  readSnapshot(): {
    value: string;
    cursor: number;
    expandedCursor: number;
    selectionCollapsed: boolean;
    terminalContextIds: string[];
  };
}

interface UseComposerTriggerEditorControllerOptions {
  clearComposerDraftContent: (threadId: ThreadId) => void;
  commitReplacementText: (text: string) => void;
  composerCursor: number;
  composerEditorRef: MutableRefObject<ComposerEditorRefValue | null>;
  promptRef: MutableRefObject<string>;
  scheduleComposerFocus: () => void;
  setComposerCursor: (cursor: number) => void;
  setComposerHighlightedItemId: (itemId: string | null) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setPrompt: (prompt: string) => void;
  setRestoredQueuedSourceProposedPlan: (threadId: ThreadId, value: null) => void;
  terminalContexts: readonly { id: string }[];
  threadId: ThreadId;
}

export function useComposerTriggerEditorController(
  options: UseComposerTriggerEditorControllerOptions,
) {
  const {
    clearComposerDraftContent,
    commitReplacementText,
    composerCursor,
    composerEditorRef,
    promptRef,
    scheduleComposerFocus,
    setComposerCursor,
    setComposerHighlightedItemId,
    setComposerTrigger,
    setPrompt,
    setRestoredQueuedSourceProposedPlan,
    terminalContexts,
    threadId,
  } = options;

  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      replacementOptions?: { expectedText?: string; cursorOffset?: number },
    ): number | false => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        replacementOptions?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== replacementOptions.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(currentText, rangeStart, rangeEnd, replacement);
      let nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      if (replacementOptions?.cursorOffset !== undefined) {
        nextCursor = Math.max(0, nextCursor + replacementOptions.cursorOffset);
      }
      promptRef.current = next.text;
      commitReplacementText(next.text);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, nextCursor)),
      );
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
      return nextCursor;
    },
    [commitReplacementText, composerEditorRef, promptRef, setComposerCursor, setComposerTrigger],
  );

  const readComposerSnapshot = useCallback(() => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) return editorSnapshot;
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      selectionCollapsed: true,
      terminalContextIds: terminalContexts.map((context) => context.id),
    };
  }, [composerCursor, composerEditorRef, promptRef, terminalContexts]);

  const resolveActiveComposerTrigger = useCallback(() => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const applyComposerTriggerReplacement = useCallback(
    (params: {
      snapshot: { value: string };
      trigger: ComposerTrigger;
      base: string;
      cursorOffset?: number;
      onApplied?: () => void;
    }): number | false => {
      const { snapshot, trigger, base, cursorOffset, onApplied } = params;
      const replacement = ensureLeadingSpaceForReplacement(
        snapshot.value,
        trigger.rangeStart,
        base,
      );
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const replacementOptions: { expectedText: string; cursorOffset?: number } = {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      };
      if (cursorOffset !== undefined) replacementOptions.cursorOffset = cursorOffset;
      const applied = applyPromptReplacement(
        trigger.rangeStart,
        replacementRangeEnd,
        replacement,
        replacementOptions,
      );
      if (applied !== false) {
        onApplied?.();
        setComposerHighlightedItemId(null);
      }
      return applied;
    },
    [applyPromptReplacement, setComposerHighlightedItemId],
  );

  const selectLocalDirectoryMention = useCallback(
    (absolutePath: string) => {
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      applyComposerTriggerReplacement({
        snapshot,
        trigger,
        base: `${formatComposerMentionToken(absolutePath)} `,
      });
    },
    [applyComposerTriggerReplacement, resolveActiveComposerTrigger],
  );

  const navigateLocalFolder = useCallback(
    (absolutePath: string) => {
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      const separator = absolutePath.includes("\\") ? "\\" : "/";
      const withTrailingSeparator = absolutePath.endsWith(separator)
        ? absolutePath
        : `${absolutePath}${separator}`;
      const base = composerMentionPathNeedsQuoting(withTrailingSeparator)
        ? `@"${withTrailingSeparator}`
        : `@${withTrailingSeparator}`;
      applyComposerTriggerReplacement({ snapshot, trigger, base });
    },
    [applyComposerTriggerReplacement, resolveActiveComposerTrigger],
  );

  const setComposerPromptValue = useCallback(
    (nextPrompt: string) => {
      setRestoredQueuedSourceProposedPlan(threadId, null);
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      setComposerHighlightedItemId(null);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
    },
    [
      composerEditorRef,
      promptRef,
      setComposerCursor,
      setComposerHighlightedItemId,
      setComposerTrigger,
      setPrompt,
      setRestoredQueuedSourceProposedPlan,
      threadId,
    ],
  );

  const clearComposerSlashDraft = useCallback(() => {
    promptRef.current = "";
    setRestoredQueuedSourceProposedPlan(threadId, null);
    clearComposerDraftContent(threadId);
    setComposerHighlightedItemId(null);
    setComposerCursor(0);
    setComposerTrigger(null);
    scheduleComposerFocus();
  }, [
    clearComposerDraftContent,
    promptRef,
    scheduleComposerFocus,
    setComposerCursor,
    setComposerHighlightedItemId,
    setComposerTrigger,
    setRestoredQueuedSourceProposedPlan,
    threadId,
  ]);

  const slashEditorActions = useMemo(
    () => ({
      resolveActiveComposerTrigger,
      applyPromptReplacement,
      clearComposerSlashDraft,
      setComposerPromptValue,
      scheduleComposerFocus,
      setComposerHighlightedItemId,
    }),
    [
      applyPromptReplacement,
      clearComposerSlashDraft,
      resolveActiveComposerTrigger,
      scheduleComposerFocus,
      setComposerHighlightedItemId,
      setComposerPromptValue,
    ],
  );

  return {
    applyComposerTriggerReplacement,
    navigateLocalFolder,
    resolveActiveComposerTrigger,
    selectLocalDirectoryMention,
    slashEditorActions,
  };
}
