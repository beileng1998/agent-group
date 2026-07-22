// FILE: useChatMarkdownComponents.tsx
// Purpose: Owns ReactMarkdown element projection for chat messages.
// Layer: Chat Markdown presentation

import React, { Suspense, type ReactNode, useMemo } from "react";
import type { Components } from "react-markdown";
import type { MessageMentionReference } from "@agent-group/contracts";

import type { DiffThemeName } from "../../lib/diffRendering";
import { dedentCode, parseCodeFenceInfo } from "../../lib/codeFence";
import { isLocalImageMarkdownSrc } from "../../lib/localImageUrls";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../../lib/workspaceFileOpener";
import { resolveMarkdownFileLinkTarget } from "../../markdown-links";
import type { ParsedTerminalContextEntry } from "../../lib/terminalContext";
import {
  COMPOSER_CHIP_SEGMENT_ATTRIBUTE,
  COMPOSER_CHIP_TAG_NAME,
  TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE,
  TERMINAL_CONTEXT_CHIP_TAG_NAME,
  parseComposerChipSegment,
} from "../../lib/remarkComposerChips";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { GeneratedMarkdownImage } from "../chat/GeneratedMarkdownImage";
import { InlineAgentChip } from "../chat/InlineAgentChip";
import { InlineMentionChip } from "../chat/InlineMentionChip";
import { InlineSkillChip } from "../chat/InlineSkillChip";
import { TerminalContextInlineChip } from "../chat/TerminalContextInlineChip";
import {
  COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME,
} from "../composerInlineChip";
import { InlineLinkChip } from "../InlineLinkChip";
import { LinkChipIcon } from "../LinkChipIcon";
import {
  CodeHighlightErrorBoundary,
  MarkdownCodeBlock,
  SuspenseShikiCodeBlock,
  extractCodeBlock,
  extractRawFenceInfo,
  inlineCodeFilePath,
  nodeToPlainText,
} from "./MarkdownCodeBlock";
import { restoreLiteralDollarPlaceholders } from "./markdownDollarProtection";
import {
  CODEX_VISUALIZATION_FILE_ATTRIBUTE,
  CODEX_VISUALIZATION_TAG_NAME,
} from "./codexVisualizationRemark";
import { CodexInlineVisualization } from "../chat/CodexInlineVisualization";

const EXTERNAL_HTTP_HREF_PATTERN = /^https?:\/\//i;
const MARKDOWN_LINK_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const MARKDOWN_EXTERNAL_LINK_CLASS_NAME =
  "inline font-medium text-[var(--info-foreground)] underline-offset-2 hover:underline";
const MARKDOWN_EXTERNAL_LINK_ICON_CLASS_NAME = `${COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME} ${COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME}`;

export type ChatMarkdownTaskToggle = (input: { sourceLine: number; checked: boolean }) => void;

function isExternalHttpHref(href: string | undefined): href is string {
  return typeof href === "string" && EXTERNAL_HTTP_HREF_PATTERN.test(href);
}

const TaskItemSourceLineContext = React.createContext<number | null>(null);

function MarkdownTaskCheckbox(props: {
  checked: boolean;
  onTaskToggle: ChatMarkdownTaskToggle | undefined;
}) {
  const { checked, onTaskToggle } = props;
  const sourceLine = React.useContext(TaskItemSourceLineContext);
  const interactive = onTaskToggle !== undefined && sourceLine !== null;
  return (
    <input
      type="checkbox"
      className="chat-markdown-task-checkbox"
      checked={checked}
      disabled={!interactive}
      {...(interactive ? { onChange: () => onTaskToggle({ sourceLine, checked: !checked }) } : {})}
    />
  );
}

function OpenableFileChip(props: {
  targetPath: string;
  theme: "light" | "dark";
  label?: ReactNode;
  href?: string;
}) {
  const opener = useWorkspaceFileOpener();
  const chipPath = props.targetPath.replace(MARKDOWN_LINK_POSITION_SUFFIX_PATTERN, "");
  return (
    <InlineMentionChip
      path={chipPath}
      theme={props.theme}
      href={props.href ?? props.targetPath}
      onActivate={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const forceExternalEditor = event.metaKey || event.ctrlKey;
        openWorkspaceFileReference(forceExternalEditor ? null : opener, props.targetPath);
      }}
      {...(opener?.prefetchFile
        ? { onHoverPrefetch: () => opener.prefetchFile?.(props.targetPath) }
        : {})}
      {...(props.label !== undefined ? { label: props.label } : {})}
    />
  );
}

function ComposerChipElement(props: {
  serializedSegment: string | undefined;
  theme: "light" | "dark";
  mentionReferences: ReadonlyArray<MessageMentionReference>;
}) {
  const segment = parseComposerChipSegment(props.serializedSegment);
  if (!segment) {
    return null;
  }
  if (segment.type === "skill") {
    return <InlineSkillChip skillName={segment.name} />;
  }
  if (segment.type === "mention") {
    return (
      <InlineMentionChip
        path={segment.path}
        theme={props.theme}
        mentionReferences={props.mentionReferences}
        {...(segment.kind ? { kind: segment.kind } : {})}
      />
    );
  }
  if (segment.type === "agent-mention") {
    return <InlineAgentChip alias={segment.alias} color={segment.color} />;
  }
  return <InlineLinkChip url={segment.url} interactive />;
}

export function useChatMarkdownComponents(input: {
  cwd: string | undefined;
  diffThemeName: DiffThemeName;
  isStreaming: boolean;
  isUserVariant: boolean;
  resolvedTheme: "light" | "dark";
  mentionReferences: ReadonlyArray<MessageMentionReference> | undefined;
  terminalContexts: ReadonlyArray<ParsedTerminalContextEntry> | undefined;
  onImageExpand: ((preview: ExpandedImagePreview) => void) | undefined;
  onTaskToggle: ChatMarkdownTaskToggle | undefined;
  visualizationThreadId: string | undefined;
  visualizationMessageId: string | undefined;
  onVisualizationFollowUp: ((prompt: string) => boolean | Promise<boolean>) | undefined;
}): Components {
  const {
    cwd,
    diffThemeName,
    isStreaming,
    isUserVariant,
    mentionReferences,
    onImageExpand,
    onTaskToggle,
    resolvedTheme,
    terminalContexts,
    visualizationThreadId,
    visualizationMessageId,
    onVisualizationFollowUp,
  } = input;

  return useMemo<Components>(
    () => ({
      a({ node: _node, href, children, ...props }) {
        const restoredHref = href ? restoreLiteralDollarPlaceholders(href) : href;
        const isExternalHttp = isExternalHttpHref(restoredHref);
        if (isUserVariant && isExternalHttp) {
          const plainText = nodeToPlainText(children);
          if (
            plainText === restoredHref ||
            restoredHref === `http://${plainText}` ||
            restoredHref === `https://${plainText}`
          ) {
            return <InlineLinkChip url={restoredHref} interactive />;
          }
        }
        const targetPath = isExternalHttp ? null : resolveMarkdownFileLinkTarget(restoredHref, cwd);
        if (!targetPath) {
          return (
            <a
              {...props}
              href={restoredHref}
              target="_blank"
              rel="noopener noreferrer"
              className={isExternalHttp ? MARKDOWN_EXTERNAL_LINK_CLASS_NAME : props.className}
            >
              {isExternalHttp ? (
                <LinkChipIcon
                  url={restoredHref}
                  className={MARKDOWN_EXTERNAL_LINK_ICON_CLASS_NAME}
                />
              ) : null}
              {children}
            </a>
          );
        }

        return (
          <OpenableFileChip
            targetPath={targetPath}
            theme={resolvedTheme}
            label={nodeToPlainText(children)}
            {...(restoredHref ? { href: restoredHref } : {})}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        const fence = parseCodeFenceInfo(extractRawFenceInfo(codeBlock.className));
        const code = dedentCode(codeBlock.code);
        return (
          <MarkdownCodeBlock code={code} fence={fence}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  language={fence.language}
                  code={code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
      code({ node: _node, className, children, ...props }) {
        if (!className) {
          const filePath = inlineCodeFilePath(nodeToPlainText(children));
          if (filePath) {
            const targetPath = resolveMarkdownFileLinkTarget(filePath, cwd) ?? filePath;
            return <OpenableFileChip targetPath={targetPath} theme={resolvedTheme} />;
          }
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      img({ node: _node, src, alt = "", ...props }) {
        const restoredSrc = src ? restoreLiteralDollarPlaceholders(src) : "";
        if (isLocalImageMarkdownSrc(restoredSrc)) {
          return (
            <GeneratedMarkdownImage
              src={restoredSrc}
              alt={alt}
              cwd={cwd}
              onImageExpand={onImageExpand}
            />
          );
        }
        return <img {...props} src={restoredSrc} alt={alt} loading="lazy" />;
      },
      li({ node, children, ...props }) {
        const isTaskItem =
          typeof props.className === "string" && props.className.includes("task-list-item");
        const sourceLine = node?.position?.start.line ?? null;
        if (!isTaskItem || sourceLine === null) {
          return <li {...props}>{children}</li>;
        }
        return (
          <li {...props}>
            <TaskItemSourceLineContext.Provider value={sourceLine}>
              {children}
            </TaskItemSourceLineContext.Provider>
          </li>
        );
      },
      input({ node: _node, ...props }) {
        if (props.type === "checkbox") {
          return (
            <MarkdownTaskCheckbox checked={props.checked === true} onTaskToggle={onTaskToggle} />
          );
        }
        return <input {...props} />;
      },
      ...({
        [COMPOSER_CHIP_TAG_NAME]: (props: {
          className?: string | undefined;
          [COMPOSER_CHIP_SEGMENT_ATTRIBUTE]?: string | undefined;
        }) => (
          <ComposerChipElement
            serializedSegment={props[COMPOSER_CHIP_SEGMENT_ATTRIBUTE]}
            theme={resolvedTheme}
            mentionReferences={mentionReferences ?? []}
          />
        ),
        [TERMINAL_CONTEXT_CHIP_TAG_NAME]: (props: {
          [TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE]?: string | undefined;
        }) => {
          const rawIndex = props[TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE];
          const index = rawIndex === undefined ? Number.NaN : Number.parseInt(rawIndex, 10);
          const context = Number.isInteger(index) ? terminalContexts?.[index] : undefined;
          if (!context) {
            return null;
          }
          const tooltipText =
            context.body.length > 0 ? `${context.header}\n${context.body}` : context.header;
          return <TerminalContextInlineChip label={context.header} tooltipText={tooltipText} />;
        },
        [CODEX_VISUALIZATION_TAG_NAME]: (props: {
          [CODEX_VISUALIZATION_FILE_ATTRIBUTE]?: string | undefined;
        }) => {
          const fileName = props[CODEX_VISUALIZATION_FILE_ATTRIBUTE];
          if (!fileName || !visualizationThreadId || !visualizationMessageId) return null;
          return (
            <CodexInlineVisualization
              fileName={fileName}
              threadId={visualizationThreadId}
              messageId={visualizationMessageId}
              theme={resolvedTheme}
              onFollowUp={onVisualizationFollowUp}
            />
          );
        },
      } as unknown as Components),
    }),
    [
      cwd,
      diffThemeName,
      isStreaming,
      isUserVariant,
      mentionReferences,
      onImageExpand,
      onTaskToggle,
      resolvedTheme,
      terminalContexts,
      visualizationThreadId,
      visualizationMessageId,
      onVisualizationFollowUp,
    ],
  );
}
