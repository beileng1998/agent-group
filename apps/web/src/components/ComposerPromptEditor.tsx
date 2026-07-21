import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { forwardRef, useMemo, useRef } from "react";

import { COMPOSER_NODE_CLASSES } from "./composer-nodes";
import { ComposerPromptEditorInner } from "./composer-editor/ComposerPromptEditorInner";
import type {
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./composer-editor/composerEditorContracts";
import { $setComposerEditorPrompt } from "./composer-editor/composerEditorState";

export type { ComposerPromptEditorHandle } from "./composer-editor/composerEditorContracts";

const COMPOSER_EDITOR_HMR_KEY = `composer-editor-${Math.random().toString(36).slice(2)}`;

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor(
  {
    value,
    cursor,
    terminalContexts,
    mentionReferences,
    disabled,
    placeholder,
    className,
    onRemoveTerminalContext,
    onCollapsePastedText,
    onChange,
    onCommandKeyDown,
    onPaste,
  },
  ref,
) {
  const initialValueRef = useRef(value);
  const initialTerminalContextsRef = useRef(terminalContexts);
  const normalizedMentionReferences = mentionReferences ?? [];
  const initialMentionReferencesRef = useRef(normalizedMentionReferences);
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "agent-group-composer-editor",
      editable: true,
      nodes: [...COMPOSER_NODE_CLASSES],
      editorState: () => {
        $setComposerEditorPrompt(
          initialValueRef.current,
          initialTerminalContextsRef.current,
          initialMentionReferencesRef.current,
        );
      },
      onError: (error) => {
        throw error;
      },
    }),
    [],
  );

  return (
    <LexicalComposer key={COMPOSER_EDITOR_HMR_KEY} initialConfig={initialConfig}>
      <ComposerPromptEditorInner
        value={value}
        cursor={cursor}
        terminalContexts={terminalContexts}
        mentionReferences={normalizedMentionReferences}
        disabled={disabled}
        placeholder={placeholder}
        onRemoveTerminalContext={onRemoveTerminalContext}
        onChange={onChange}
        onPaste={onPaste}
        editorRef={ref}
        {...(onCollapsePastedText ? { onCollapsePastedText } : {})}
        {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
        {...(className ? { className } : {})}
      />
    </LexicalComposer>
  );
});
