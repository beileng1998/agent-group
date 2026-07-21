import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type EditorState,
} from "lexical";
import { useContext, useEffect, useRef } from "react";

import { isCollapsedCursorAdjacentToInlineToken } from "~/composer-logic";
import {
  matchComposerLinkToken,
  matchComposerSlashCommandChipToken,
} from "~/composer-editor-mentions";
import { shouldCollapsePastedText } from "~/lib/composerPastedText";
import { parseBareComposerLink } from "~/lib/linkChips";
import {
  $createComposerLinkNode,
  $createComposerSlashCommandNode,
  ComposerTerminalContextNode,
  isComposerInlineTokenNode,
} from "../composer-nodes";
import { ComposerTerminalContextActionsContext } from "./composerEditorContext";
import type { ComposerCommandKey } from "./composerEditorContracts";
import {
  $getComposerRootLength,
  $readSelectionOffsetFromEditorState,
  $setSelectionAtComposerOffset,
  getAbsoluteOffsetForPoint,
} from "./composerEditorState";

function ComposerCommandKeyPlugin(props: {
  onCommandKeyDown?: (key: ComposerCommandKey, event: KeyboardEvent) => boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleCommand = (key: ComposerCommandKey, event: KeyboardEvent | null): boolean => {
      if (!props.onCommandKeyDown || !event) return false;
      const handled = props.onCommandKeyDown(key, event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return handled;
    };
    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleCommand("ArrowDown", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleCommand("ArrowUp", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleCommand("Enter", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleCommand("Tab", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterSlash = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) =>
        event instanceof KeyboardEvent && event.key === "/" ? handleCommand("Slash", event) : false,
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterArrowDown();
      unregisterArrowUp();
      unregisterEnter();
      unregisterTab();
      unregisterSlash();
    };
  }, [editor, props]);

  return null;
}

function ComposerInlineTokenArrowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          if (currentOffset <= 0) return;
          if (
            !isCollapsedCursorAdjacentToInlineToken(
              $getRoot().getTextContent(),
              currentOffset,
              "left",
            )
          ) {
            return;
          }
          nextOffset = currentOffset - 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => $setSelectionAtComposerOffset(selectionOffset));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          if (currentOffset >= $getComposerRootLength()) return;
          if (
            !isCollapsedCursorAdjacentToInlineToken(
              $getRoot().getTextContent(),
              currentOffset,
              "right",
            )
          ) {
            return;
          }
          nextOffset = currentOffset + 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => $setSelectionAtComposerOffset(selectionOffset));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}

function ComposerInlineTokenSelectionNormalizePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        let afterOffset: number | null = null;
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const anchorNode = selection.anchor.getNode();
          if (!isComposerInlineTokenNode(anchorNode) || selection.anchor.offset === 0) return;
          afterOffset = getAbsoluteOffsetForPoint(anchorNode, 0) + 1;
        });
        if (afterOffset !== null) {
          queueMicrotask(() => editor.update(() => $setSelectionAtComposerOffset(afterOffset!)));
        }
      }),
    [editor],
  );

  return null;
}

function ComposerInlineTokenBackspacePlugin() {
  const [editor] = useLexicalComposerContext();
  const { onRemoveTerminalContext } = useContext(ComposerTerminalContextActionsContext);

  useEffect(
    () =>
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const anchorNode = selection.anchor.getNode();
          const selectionOffset = $readSelectionOffsetFromEditorState(0);
          const removeInlineTokenNode = (candidate: unknown): boolean => {
            if (!isComposerInlineTokenNode(candidate)) return false;
            const tokenStart = getAbsoluteOffsetForPoint(candidate, 0);
            candidate.remove();
            if (candidate instanceof ComposerTerminalContextNode) {
              onRemoveTerminalContext(candidate.__context.id);
              $setSelectionAtComposerOffset(selectionOffset);
            } else {
              $setSelectionAtComposerOffset(tokenStart);
            }
            event?.preventDefault();
            return true;
          };
          if (removeInlineTokenNode(anchorNode)) return true;
          if ($isTextNode(anchorNode)) {
            if (selection.anchor.offset > 0) return false;
            if (removeInlineTokenNode(anchorNode.getPreviousSibling())) return true;
            const parent = anchorNode.getParent();
            if ($isElementNode(parent)) {
              const index = anchorNode.getIndexWithinParent();
              if (index > 0 && removeInlineTokenNode(parent.getChildAtIndex(index - 1)))
                return true;
            }
            return false;
          }
          if ($isElementNode(anchorNode)) {
            const childIndex = selection.anchor.offset - 1;
            if (childIndex >= 0 && removeInlineTokenNode(anchorNode.getChildAtIndex(childIndex))) {
              return true;
            }
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onRemoveTerminalContext],
  );

  return null;
}

function ComposerSlashCommandTransformPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        if (isComposerInlineTokenNode(node)) return;
        const match = matchComposerSlashCommandChipToken(node.getTextContent());
        if (!match) return;
        const splitNodes = node.splitText(match.start, match.end);
        const commandNode = match.start === 0 ? splitNodes[0] : splitNodes[1];
        commandNode?.replace($createComposerSlashCommandNode(match.command));
      }),
    [editor],
  );
  return null;
}

function ComposerLinkTransformPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        if (isComposerInlineTokenNode(node)) return;
        const match = matchComposerLinkToken(node.getTextContent(), {
          includeTrailingTokenAtEnd: false,
        });
        if (!match) return;
        const splitNodes = node.splitText(match.start, match.end);
        const urlNode = match.start === 0 ? splitNodes[0] : splitNodes[1];
        urlNode?.replace($createComposerLinkNode(match.url));
      }),
    [editor],
  );
  return null;
}

function ComposerLinkPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
          const url = parseBareComposerLink(clipboardData?.getData("text/plain") ?? "");
          if (!url) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          selection.insertNodes([$createComposerLinkNode(url)]);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

function ComposerBigPastePlugin(props: { onCollapsePastedText: (text: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const onCollapseRef = useRef(props.onCollapsePastedText);
  useEffect(() => {
    onCollapseRef.current = props.onCollapsePastedText;
  }, [props.onCollapsePastedText]);
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
          if (!clipboardData || clipboardData.files.length > 0) return false;
          const text = clipboardData.getData("text/plain");
          if (!shouldCollapsePastedText(text)) return false;
          event.preventDefault();
          onCollapseRef.current(text);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

export function ComposerEditorPlugins({
  onChange,
  onCommandKeyDown,
  onCollapsePastedText,
}: {
  onChange: (editorState: EditorState) => void;
  onCommandKeyDown?: (key: ComposerCommandKey, event: KeyboardEvent) => boolean;
  onCollapsePastedText?: (text: string) => void;
}) {
  return (
    <>
      <OnChangePlugin onChange={onChange} />
      <ComposerCommandKeyPlugin {...(onCommandKeyDown ? { onCommandKeyDown } : {})} />
      <ComposerInlineTokenArrowPlugin />
      <ComposerInlineTokenSelectionNormalizePlugin />
      <ComposerInlineTokenBackspacePlugin />
      <ComposerSlashCommandTransformPlugin />
      <ComposerLinkTransformPlugin />
      <ComposerLinkPastePlugin />
      {onCollapsePastedText ? (
        <ComposerBigPastePlugin onCollapsePastedText={onCollapsePastedText} />
      ) : null}
      <HistoryPlugin />
    </>
  );
}
