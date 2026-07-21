import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, $isRangeSelection, type EditorState } from "lexical";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import type {
  ComposerPromptEditorInnerProps,
  ComposerPromptSnapshot,
} from "./composerEditorContracts";
import {
  $readExpandedSelectionOffsetFromEditorState,
  $readSelectionOffsetFromEditorState,
  $setComposerEditorPrompt,
  $setSelectionAtComposerOffset,
  clampExpandedCursor,
  collectTerminalContextIds,
  mentionReferencesSignature,
  terminalContextSignature,
} from "./composerEditorState";

type ControllerProps = Pick<
  ComposerPromptEditorInnerProps,
  | "value"
  | "cursor"
  | "terminalContexts"
  | "mentionReferences"
  | "disabled"
  | "onChange"
  | "editorRef"
>;

export function useComposerPromptEditorController({
  value,
  cursor,
  terminalContexts,
  mentionReferences = [],
  disabled,
  onChange,
  editorRef,
}: ControllerProps): (editorState: EditorState) => void {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  const initialCursor = clampCollapsedComposerCursor(value, cursor);
  const terminalContextsSignature = terminalContextSignature(terminalContexts);
  const terminalContextsSignatureRef = useRef(terminalContextsSignature);
  const mentionsSignature = mentionReferencesSignature(mentionReferences);
  const mentionsSignatureRef = useRef(mentionsSignature);
  const snapshotRef = useRef<ComposerPromptSnapshot>({
    value,
    cursor: initialCursor,
    expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
    selectionCollapsed: true,
    terminalContextIds: terminalContexts.map((context) => context.id),
  });
  const isApplyingControlledUpdateRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Disabling contenteditable drops browser focus to <body>. Restore it after dispatch connects.
  const restoreFocusOnEnableRef = useRef(false);
  useEffect(() => {
    if (disabled) {
      const rootElement = editor.getRootElement();
      restoreFocusOnEnableRef.current = Boolean(
        rootElement && document.activeElement === rootElement,
      );
      editor.setEditable(false);
      return;
    }
    editor.setEditable(true);
    if (restoreFocusOnEnableRef.current) {
      restoreFocusOnEnableRef.current = false;
      editor.getRootElement()?.focus();
    }
  }, [disabled, editor]);

  useLayoutEffect(() => {
    const normalizedCursor = clampCollapsedComposerCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    const contextsChanged = terminalContextsSignatureRef.current !== terminalContextsSignature;
    const mentionsChanged = mentionsSignatureRef.current !== mentionsSignature;
    if (
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor &&
      !contextsChanged &&
      !mentionsChanged
    ) {
      return;
    }

    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
      selectionCollapsed: true,
      terminalContextIds: terminalContexts.map((context) => context.id),
    };
    terminalContextsSignatureRef.current = terminalContextsSignature;
    mentionsSignatureRef.current = mentionsSignature;

    const rootElement = editor.getRootElement();
    const isFocused = Boolean(rootElement && document.activeElement === rootElement);
    if (previousSnapshot.value === value && !contextsChanged && !mentionsChanged && !isFocused) {
      return;
    }

    isApplyingControlledUpdateRef.current = true;
    editor.update(() => {
      const shouldRewriteEditorState =
        previousSnapshot.value !== value || contextsChanged || mentionsChanged;
      if (shouldRewriteEditorState) {
        $setComposerEditorPrompt(value, terminalContexts, mentionReferences);
      }
      if (shouldRewriteEditorState || isFocused) {
        $setSelectionAtComposerOffset(normalizedCursor);
      }
    });
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false;
    });
  }, [
    cursor,
    editor,
    mentionReferences,
    mentionsSignature,
    terminalContexts,
    terminalContextsSignature,
    value,
  ]);

  const focusAt = useCallback(
    (nextCursor: number) => {
      const rootElement = editor.getRootElement();
      if (!rootElement) return;
      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor);
      rootElement.focus();
      editor.update(() => {
        $setSelectionAtComposerOffset(boundedCursor);
      });
      snapshotRef.current = {
        value: snapshotRef.current.value,
        cursor: boundedCursor,
        expandedCursor: expandCollapsedComposerCursor(snapshotRef.current.value, boundedCursor),
        selectionCollapsed: true,
        terminalContextIds: snapshotRef.current.terminalContextIds,
      };
      onChangeRef.current(
        snapshotRef.current.value,
        boundedCursor,
        snapshotRef.current.expandedCursor,
        false,
        snapshotRef.current.terminalContextIds,
      );
    },
    [editor],
  );

  const blurEditor = useCallback(() => {
    editor.getRootElement()?.blur();
  }, [editor]);

  const isEditorFocused = useCallback(() => {
    const rootElement = editor.getRootElement();
    return Boolean(
      rootElement && typeof document !== "undefined" && document.activeElement === rootElement,
    );
  }, [editor]);

  const readSnapshot = useCallback((): ComposerPromptSnapshot => {
    let snapshot = snapshotRef.current;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const selectionCollapsed = !$isRangeSelection(selection) || selection.isCollapsed();
      const nextValue = $getRoot().getTextContent();
      const fallbackCursor = clampCollapsedComposerCursor(nextValue, snapshotRef.current.cursor);
      const nextCursor = clampCollapsedComposerCursor(
        nextValue,
        $readSelectionOffsetFromEditorState(fallbackCursor),
      );
      const fallbackExpandedCursor = clampExpandedCursor(
        nextValue,
        snapshotRef.current.expandedCursor,
      );
      const nextExpandedCursor = clampExpandedCursor(
        nextValue,
        $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor),
      );
      snapshot = {
        value: nextValue,
        cursor: nextCursor,
        expandedCursor: nextExpandedCursor,
        selectionCollapsed,
        terminalContextIds: collectTerminalContextIds($getRoot()),
      };
    });
    snapshotRef.current = snapshot;
    return snapshot;
  }, [editor]);

  useImperativeHandle(
    editorRef,
    () => ({
      blur: blurEditor,
      focus: () => focusAt(snapshotRef.current.cursor),
      focusAt,
      focusAtEnd: () => {
        focusAt(
          collapseExpandedComposerCursor(
            snapshotRef.current.value,
            snapshotRef.current.value.length,
          ),
        );
      },
      isFocused: isEditorFocused,
      readSnapshot,
    }),
    [blurEditor, focusAt, isEditorFocused, readSnapshot],
  );

  return useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const selection = $getSelection();
      const selectionCollapsed = !$isRangeSelection(selection) || selection.isCollapsed();
      const nextValue = $getRoot().getTextContent();
      const fallbackCursor = clampCollapsedComposerCursor(nextValue, snapshotRef.current.cursor);
      const nextCursor = clampCollapsedComposerCursor(
        nextValue,
        $readSelectionOffsetFromEditorState(fallbackCursor),
      );
      const fallbackExpandedCursor = clampExpandedCursor(
        nextValue,
        snapshotRef.current.expandedCursor,
      );
      const nextExpandedCursor = clampExpandedCursor(
        nextValue,
        $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor),
      );
      const terminalContextIds = collectTerminalContextIds($getRoot());
      const previousSnapshot = snapshotRef.current;
      if (
        previousSnapshot.value === nextValue &&
        previousSnapshot.cursor === nextCursor &&
        previousSnapshot.expandedCursor === nextExpandedCursor &&
        previousSnapshot.terminalContextIds.length === terminalContextIds.length &&
        previousSnapshot.terminalContextIds.every((id, index) => id === terminalContextIds[index])
      ) {
        return;
      }
      if (isApplyingControlledUpdateRef.current) return;
      snapshotRef.current = {
        value: nextValue,
        cursor: nextCursor,
        expandedCursor: nextExpandedCursor,
        selectionCollapsed,
        terminalContextIds,
      };
      const cursorAdjacentToMention =
        isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, "left") ||
        isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, "right");
      onChangeRef.current(
        nextValue,
        nextCursor,
        nextExpandedCursor,
        cursorAdjacentToMention,
        terminalContextIds,
      );
    });
  }, []);
}
