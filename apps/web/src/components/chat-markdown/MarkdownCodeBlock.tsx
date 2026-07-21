// FILE: MarkdownCodeBlock.tsx
// Purpose: Renders fenced code with lazy highlighting, copy, and wrap controls.
// Layer: Chat Markdown presentation

import React, {
  Children,
  type ReactNode,
  isValidElement,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckIcon, CopyIcon, TextWrapIcon } from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";

import { copyTextToClipboard } from "../../hooks/useCopyToClipboard";
import type { DiffThemeName } from "../../lib/diffRendering";
import type { CodeFenceInfo } from "../../lib/codeFence";
import { getFileIconName, pathLooksLikeKnownFile } from "../../file-icons";
import { IconButton } from "../ui/icon-button";

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const INLINE_CODE_FILE_PATH_MAX_LENGTH = 120;

export class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function extractRawFenceInfo(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  return match?.[1] ?? "text";
}

export function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

export function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(onlyChild)) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

export function inlineCodeFilePath(raw: string): string | null {
  const value = raw.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (
    value.length === 0 ||
    value.length > INLINE_CODE_FILE_PATH_MAX_LENGTH ||
    /\s/.test(value) ||
    value.includes("://")
  ) {
    return null;
  }
  return pathLooksLikeKnownFile(value) ? value : null;
}

function CodeBlockHeaderTitle({ fence }: { fence: CodeFenceInfo }) {
  if (fence.isFileReference && fence.fileName) {
    return (
      <span className="chat-markdown-codeblock__file" title={fence.filePath ?? fence.fileName}>
        <CentralIcon
          name={getFileIconName(fence.filePath ?? fence.fileName)}
          className="chat-markdown-codeblock__file-icon"
        />
        <span className="chat-markdown-codeblock__file-name">{fence.fileName}</span>
        {fence.directory ? (
          <span className="chat-markdown-codeblock__file-dir">{fence.directory}</span>
        ) : null}
        {fence.lineRange ? (
          <span className="chat-markdown-codeblock__file-lines">{fence.lineRange}</span>
        ) : null}
      </span>
    );
  }

  return <span className="chat-markdown-codeblock__lang">{fence.language}</span>;
}

export function MarkdownCodeBlock({
  code,
  fence,
  children,
}: {
  code: string;
  fence: CodeFenceInfo;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    void copyTextToClipboard(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);
  const toggleWrap = useCallback(() => setWrap((previous) => !previous), []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock" data-wrap={wrap ? "true" : "false"}>
      <div className="chat-markdown-codeblock__header">
        <CodeBlockHeaderTitle fence={fence} />
        <div className="chat-markdown-codeblock__actions">
          <IconButton
            className="chat-markdown-codeblock__action"
            onClick={toggleWrap}
            title={wrap ? "Disable soft wrap" : "Enable soft wrap"}
            label={wrap ? "Disable soft wrap" : "Enable soft wrap"}
            aria-pressed={wrap}
            data-active={wrap ? "true" : "false"}
            size="icon-xs"
            variant="ghost"
          >
            <TextWrapIcon className="size-3" />
          </IconButton>
          <IconButton
            className="chat-markdown-codeblock__action"
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy code"}
            label={copied ? "Copied" : "Copy code"}
            size="icon-xs"
            variant="ghost"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </IconButton>
        </div>
      </div>
      <div className="chat-markdown-codeblock__body">{children}</div>
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  language: string;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

type SyntaxHighlightingModule = typeof import("../../lib/syntaxHighlighting");
let syntaxHighlightingModulePromise: Promise<SyntaxHighlightingModule> | null = null;

function getSyntaxHighlightingModulePromise(): Promise<SyntaxHighlightingModule> {
  syntaxHighlightingModulePromise ??= import("../../lib/syntaxHighlighting");
  return syntaxHighlightingModulePromise;
}

export function SuspenseShikiCodeBlock(props: SuspenseShikiCodeBlockProps) {
  const syntaxHighlighting = use(getSyntaxHighlightingModulePromise());
  return <LoadedShikiCodeBlock syntaxHighlighting={syntaxHighlighting} {...props} />;
}

function LoadedShikiCodeBlock({
  syntaxHighlighting,
  language,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps & { syntaxHighlighting: SyntaxHighlightingModule }) {
  const cacheKey = syntaxHighlighting.createSyntaxHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming
    ? syntaxHighlighting.getCachedSyntaxHighlightedHtml(cacheKey)
    : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      syntaxHighlighting={syntaxHighlighting}
      cacheKey={cacheKey}
      language={language}
      code={code}
      themeName={themeName}
      isStreaming={isStreaming}
    />
  );
}

function UncachedShikiCodeBlock({
  syntaxHighlighting,
  cacheKey,
  language,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps & {
  syntaxHighlighting: SyntaxHighlightingModule;
  cacheKey: string;
}) {
  const highlighter = use(syntaxHighlighting.getSyntaxHighlighterPromise(language));
  const highlightedHtml = useMemo(
    () =>
      syntaxHighlighting.highlightCodeToHtmlWithFallback(highlighter, code, language, themeName),
    [code, highlighter, language, syntaxHighlighting, themeName],
  );

  useEffect(() => {
    if (!isStreaming) {
      syntaxHighlighting.cacheSyntaxHighlightedHtml(cacheKey, highlightedHtml, code);
    }
  }, [cacheKey, code, highlightedHtml, isStreaming, syntaxHighlighting]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}
