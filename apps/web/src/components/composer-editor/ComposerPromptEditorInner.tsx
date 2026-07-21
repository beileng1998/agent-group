import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import {
  COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME,
  COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
} from "../chat/composerPickerStyles";
import { ComposerEditorPlugins } from "./ComposerEditorPlugins";
import { ComposerTerminalContextActionsContext } from "./composerEditorContext";
import type { ComposerPromptEditorInnerProps } from "./composerEditorContracts";
import { useComposerPromptEditorController } from "./useComposerPromptEditorController";

export function ComposerPromptEditorInner({
  value,
  cursor,
  terminalContexts,
  mentionReferences = [],
  disabled,
  placeholder,
  className,
  onRemoveTerminalContext,
  onCollapsePastedText,
  onChange,
  onCommandKeyDown,
  onPaste,
  editorRef,
}: ComposerPromptEditorInnerProps) {
  const handleEditorChange = useComposerPromptEditorController({
    value,
    cursor,
    terminalContexts,
    mentionReferences,
    disabled,
    onChange,
    editorRef,
  });
  const terminalContextActions = useMemo(
    () => ({ onRemoveTerminalContext }),
    [onRemoveTerminalContext],
  );

  return (
    <ComposerTerminalContextActionsContext.Provider value={terminalContextActions}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className={cn(
                "block max-h-[200px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-foreground focus:outline-none",
                COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
                COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME,
                className,
              )}
              data-testid="composer-editor"
              aria-placeholder={placeholder}
              placeholder={<span />}
              onPaste={onPaste}
            />
          }
          placeholder={
            terminalContexts.length > 0 ? null : (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0",
                  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
                  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                )}
              >
                {placeholder}
              </div>
            )
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComposerEditorPlugins
          onChange={handleEditorChange}
          {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
          {...(onCollapsePastedText ? { onCollapsePastedText } : {})}
        />
      </div>
    </ComposerTerminalContextActionsContext.Provider>
  );
}
