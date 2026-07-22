// FILE: ChatMarkdown.tsx
// Purpose: Composes assistant and user Markdown parsing and presentation.
// Layer: Web chat presentation component

import type { MessageMentionReference, ThreadMarker } from "@agent-group/contracts";
import "katex/dist/katex.min.css";
import {
  type CSSProperties,
  type ComponentProps,
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { useTheme } from "../hooks/useTheme";
import { useSmoothStreamedText } from "../hooks/useSmoothStreamedText";
import { resolveDiffThemeName } from "../lib/diffRendering";
import type { ParsedTerminalContextEntry } from "../lib/terminalContext";
import { rewriteMarkdownFileUriHref } from "../markdown-links";
import { createComposerChipsRemarkPlugin } from "../lib/remarkComposerChips";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { formatInlineTerminalContextLabel } from "./chat/userMessageTerminalContexts";
import {
  protectLiteralMarkdownDollars,
  rehypeRestoreLiteralDollars,
  restoreLiteralDollarPlaceholders,
} from "./chat-markdown/markdownDollarProtection";
import { createThreadMarkerRemarkPlugin } from "./chat-markdown/threadMarkerRemark";
import { createTranscriptSourceMapRemarkPlugin } from "./chat-markdown/transcriptSourceMapRemark";
import {
  type ChatMarkdownTaskToggle,
  useChatMarkdownComponents,
} from "./chat-markdown/useChatMarkdownComponents";
import { createCodexVisualizationRemarkPlugin } from "./chat-markdown/codexVisualizationRemark";

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  markers?: readonly ThreadMarker[] | undefined;
  variant?: "assistant" | "user";
  mentionReferences?: ReadonlyArray<MessageMentionReference> | undefined;
  terminalContexts?: ReadonlyArray<ParsedTerminalContextEntry> | undefined;
  onTaskToggle?: ChatMarkdownTaskToggle | undefined;
  visualizationThreadId?: string | undefined;
  visualizationMessageId?: string | undefined;
  onVisualizationFollowUp?: ((prompt: string) => boolean | Promise<boolean>) | undefined;
}

type MarkdownRemarkPlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
type MarkdownRehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

const MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: true }],
];
const TRANSCRIPT_SOURCE_MAP_REMARK_PLUGIN = createTranscriptSourceMapRemarkPlugin();
const CODEX_VISUALIZATION_REMARK_PLUGIN = createCodexVisualizationRemarkPlugin();
const USER_MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [remarkGfm, remarkBreaks];
const USER_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [];
const MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  [rehypeKatex, { output: "htmlAndMathml", strict: false, throwOnError: false }],
  rehypeRestoreLiteralDollars,
];

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  className = "text-sm leading-relaxed",
  style,
  onImageExpand,
  markers,
  onTaskToggle,
  variant = "assistant",
  mentionReferences,
  terminalContexts,
  visualizationThreadId,
  visualizationMessageId,
  onVisualizationFollowUp,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const isUserVariant = variant === "user";
  const smoothedText = useSmoothStreamedText(text, isStreaming);
  const normalizedText = useMemo(
    () => (isUserVariant ? smoothedText : protectLiteralMarkdownDollars(smoothedText)),
    [isUserVariant, smoothedText],
  );
  const deferredNormalizedText = useDeferredValue(normalizedText);
  const renderedText = isStreaming ? deferredNormalizedText : normalizedText;
  const threadMarkerRemarkPlugin = useMemo(
    () =>
      markers && markers.length > 0 ? createThreadMarkerRemarkPlugin({ text, markers }) : null,
    [markers, text],
  );
  const composerChipsRemarkPlugin = useMemo(
    () =>
      isUserVariant
        ? createComposerChipsRemarkPlugin(
            mentionReferences ?? [],
            (terminalContexts ?? []).map((context, index) => ({
              label: formatInlineTerminalContextLabel(context.header),
              index,
            })),
          )
        : null,
    [isUserVariant, mentionReferences, terminalContexts],
  );
  const remarkPlugins = useMemo<MarkdownRemarkPlugins>(() => {
    if (composerChipsRemarkPlugin) {
      return [...USER_MARKDOWN_REMARK_PLUGINS, composerChipsRemarkPlugin];
    }
    const assistantPlugins: MarkdownRemarkPlugins = [
      ...MARKDOWN_REMARK_PLUGINS,
      ...(visualizationThreadId && visualizationMessageId
        ? [CODEX_VISUALIZATION_REMARK_PLUGIN]
        : []),
      TRANSCRIPT_SOURCE_MAP_REMARK_PLUGIN,
    ];
    return threadMarkerRemarkPlugin
      ? [...assistantPlugins, threadMarkerRemarkPlugin]
      : assistantPlugins;
  }, [
    composerChipsRemarkPlugin,
    threadMarkerRemarkPlugin,
    visualizationMessageId,
    visualizationThreadId,
  ]);
  const rehypePlugins = isUserVariant ? USER_MARKDOWN_REHYPE_PLUGINS : MARKDOWN_REHYPE_PLUGINS;
  const markdownUrlTransform = useCallback((href: string) => {
    const restoredHref = restoreLiteralDollarPlaceholders(href);
    return rewriteMarkdownFileUriHref(restoredHref) ?? defaultUrlTransform(restoredHref);
  }, []);
  const markdownComponents: Components = useChatMarkdownComponents({
    cwd,
    diffThemeName,
    isStreaming,
    isUserVariant,
    resolvedTheme,
    mentionReferences,
    terminalContexts,
    onImageExpand,
    onTaskToggle,
    visualizationThreadId,
    visualizationMessageId,
    onVisualizationFollowUp,
  });

  return (
    <div
      className={`chat-markdown ${isUserVariant ? "chat-markdown--user " : ""}w-full min-w-0 ${className} text-foreground`}
      style={style}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
