// FILE: MessagesTimeline.assistantRow.tsx
// Purpose: Render one assistant message with inline work, collapse, footer, and changes.
// Layer: Web chat timeline presentation

import type { MessageId, ThreadId, ThreadMarker, TurnId } from "@agent-group/contracts";
import type { CSSProperties, ReactNode } from "react";
import { PinIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import type { TimestampFormat } from "../../appSettings";
import { formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { disclosureContentClassName } from "~/lib/disclosureMotion";
import { MessageActionButton, MESSAGE_ACTION_ICON_CLASS_NAME } from "./MessageActionButton";
import { MessageCopyButton } from "./MessageCopyButton";
import { SettledTurnChangedFiles } from "./MessagesTimeline.changedFiles";
import {
  formatInlineWorkSummary,
  type SettledTurnCollapseTransition,
} from "./MessagesTimeline.controllers";
import {
  type CollapsedTurnItem,
  type MessagesTimelineRow,
  resolveAssistantMessageCopyState,
  resolveAssistantMessageDisplayText,
} from "./MessagesTimeline.logic";
import { MESSAGE_HOVER_REVEAL_CLASS_NAME } from "./MessagesTimeline.styles";
import {
  isFileChangeWorkEntry,
  prefersCompactWorkEntryRow,
  type TimelineWorkEntry,
} from "./MessagesTimeline.workEntryModel";
import { SimpleWorkEntryRow } from "./MessagesTimeline.workEntryRow";
import { EditedFileRowContent } from "./MessagesTimeline.workEntrySurfaces";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

const MAX_VISIBLE_INLINE_TOOL_ENTRIES = 4;
const EMPTY_MESSAGE_MARKERS: readonly ThreadMarker[] = [];

type AssistantMessageRow = Extract<MessagesTimelineRow, { kind: "message" }>;

export interface AssistantMessageRowContext {
  threadId?: ThreadId | undefined;
  activeTurnInProgress: boolean;
  appTypographyScale: { chatMetaPx: number };
  canPinMessage?: ((messageId: MessageId) => boolean) | undefined;
  chatMessageFooterStyle: CSSProperties;
  chatTypographyStyle: CSSProperties;
  expandedCollapsedWork: Record<string, boolean>;
  expandedFileChangesByTurnId: Record<string, boolean>;
  expandedFileListByTurnId: Record<string, boolean>;
  expandedWorkGroupsState: Record<string, boolean>;
  handleToggleWorkGroup: (groupId: string) => void;
  markdownCwd: string | undefined;
  normalizedChatFontSizePx: number;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onVisualizationFollowUp?: ((prompt: string) => boolean | Promise<boolean>) | undefined;
  onOpenAgentActivity?: ((activityId: string) => void) | undefined;
  onOpenAutomation?: ((automationId: string) => void) | undefined;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  onOpenToolDetails: (workEntry: TimelineWorkEntry) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onTogglePinMessage?: ((messageId: MessageId) => void) | undefined;
  onUndoTurnFiles?: ((turnCounts: readonly number[]) => void) | undefined;
  pinnedMessageIds: ReadonlySet<MessageId>;
  resolvedTheme: "light" | "dark";
  scrollTailExpansionToEnd: () => void;
  setCollapsedWorkExpanded: (messageId: string, open: boolean) => void;
  settledTurnCollapseTransitions: Readonly<Record<string, SettledTurnCollapseTransition>>;
  tailContentRowId: string | null;
  threadMarkersByMessageId: ReadonlyMap<MessageId, readonly ThreadMarker[]>;
  timestampFormat: TimestampFormat;
  toggleFileChangesExpanded: (turnId: TurnId) => void;
  toggleFileListExpanded: (turnId: TurnId) => void;
}

export function renderAssistantMessageRow(
  row: AssistantMessageRow,
  context: AssistantMessageRowContext,
): ReactNode {
  const {
    threadId,
    activeTurnInProgress,
    appTypographyScale,
    canPinMessage,
    chatMessageFooterStyle,
    chatTypographyStyle,
    expandedCollapsedWork,
    expandedFileChangesByTurnId,
    expandedFileListByTurnId,
    expandedWorkGroupsState,
    handleToggleWorkGroup,
    markdownCwd,
    normalizedChatFontSizePx,
    onImageExpand,
    onVisualizationFollowUp,
    onOpenAgentActivity,
    onOpenAutomation,
    onOpenThread,
    onOpenToolDetails: openToolDetails,
    onOpenTurnDiff,
    onTogglePinMessage,
    onUndoTurnFiles,
    pinnedMessageIds,
    resolvedTheme,
    scrollTailExpansionToEnd,
    setCollapsedWorkExpanded,
    settledTurnCollapseTransitions,
    tailContentRowId,
    threadMarkersByMessageId,
    timestampFormat,
    toggleFileChangesExpanded,
    toggleFileListExpanded,
  } = context;
  const messageText = resolveAssistantMessageDisplayText(row);
  const messageMarkers = threadMarkersByMessageId.get(row.message.id) ?? EMPTY_MESSAGE_MARKERS;
  const buildWorkDisplay = (workEntries: WorkLogEntry[], workGroupId: string | null) => {
    const toolEntries = workEntries.filter((entry) => entry.tone === "tool");
    const statusEntries = workEntries.filter((entry) => entry.tone !== "tool");
    const toolGroupId = toolEntries.length > 0 ? workGroupId : null;
    const toolExpanded =
      toolGroupId !== null ? (expandedWorkGroupsState[toolGroupId] ?? false) : false;
    const visibleToolEntries =
      toolExpanded || toolEntries.length <= MAX_VISIBLE_INLINE_TOOL_ENTRIES
        ? toolEntries
        : activeTurnInProgress
          ? toolEntries.slice(-MAX_VISIBLE_INLINE_TOOL_ENTRIES)
          : toolEntries.slice(0, MAX_VISIBLE_INLINE_TOOL_ENTRIES);
    const hasGenericFileChangeEntry = toolEntries.some(
      (workEntry) =>
        isFileChangeWorkEntry(workEntry) && (workEntry.changedFiles?.length ?? 0) === 0,
    );
    const visibleRenderableToolEntries = visibleToolEntries.filter(
      (workEntry) =>
        !(
          hasGenericFileChangeEntry &&
          isFileChangeWorkEntry(workEntry) &&
          (workEntry.changedFiles?.length ?? 0) === 0
        ),
    );
    return {
      toolEntries,
      statusEntries,
      toolGroupId,
      toolExpanded,
      visibleRenderableToolEntries,
      hiddenToolCount: toolEntries.length - visibleToolEntries.length,
      hasGenericFileChangeEntry,
    };
  };
  const leadingWorkDisplay = buildWorkDisplay(
    row.leadingWorkEntries ?? [],
    row.leadingWorkGroupId ?? null,
  );
  const inlineWorkDisplay = buildWorkDisplay(
    row.inlineWorkEntries ?? [],
    row.inlineWorkGroupId ?? null,
  );
  const inlineWorkSummary =
    leadingWorkDisplay.toolEntries.length + inlineWorkDisplay.toolEntries.length > 0
      ? null
      : formatInlineWorkSummary([
          ...leadingWorkDisplay.statusEntries,
          ...inlineWorkDisplay.statusEntries,
        ]);
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: row.assistantCopyStreaming,
  });
  const messagePinned = pinnedMessageIds?.has(row.message.id) ?? false;
  const messageCanPin = canPinMessage?.(row.message.id) ?? true;
  // Offer the pin toggle wherever copy is offered (a complete, terminal answer);
  // keep it visible for an already-pinned message so it can always be unpinned.
  const showPinToggle =
    messageCanPin && Boolean(onTogglePinMessage) && (assistantCopyState.visible || messagePinned);
  const turnSummary = row.assistantTurnDiffSummary;
  const fileDiffStatByPath = new Map(
    (turnSummary?.files ?? []).map((file) => [
      file.path,
      {
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
      },
    ]),
  );
  const inlineEditedFilesFromTurnSummary =
    (leadingWorkDisplay.hasGenericFileChangeEntry || inlineWorkDisplay.hasGenericFileChangeEntry) &&
    (turnSummary?.files.length ?? 0) > 0
      ? turnSummary!.files
      : [];
  // Only the turn's final answer carries a timestamp. Intermediate
  // working preambles (and their inline tool calls) stay timestamp-free
  // so a live turn reads as one block, not a stack of timestamped
  // fragments. `showAssistantCopyButton` is exactly the terminal-message
  // signal (see deriveTerminalAssistantMessageIds).
  const isTerminalAssistantMessage = row.showAssistantCopyButton;
  const assistantMeta = [
    isTerminalAssistantMessage
      ? formatShortTimestamp(row.message.createdAt, timestampFormat)
      : null,
    inlineWorkSummary,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  const collapsedTurnItems = row.collapsedTurnItems;
  const hasCollapsedWork = Boolean(collapsedTurnItems && collapsedTurnItems.length > 0);
  const isCollapsedWorkExpanded = hasCollapsedWork
    ? (expandedCollapsedWork[row.message.id] ?? false)
    : false;
  const settledCollapseTransition = isCollapsedWorkExpanded
    ? undefined
    : settledTurnCollapseTransitions[row.message.id];
  const isTailContentRow = row.id === tailContentRowId;
  const renderWorkDisplay = (
    display: typeof leadingWorkDisplay,
    placement: "leading" | "inline",
  ) => (
    <>
      {!hasCollapsedWork && display.visibleRenderableToolEntries.length > 0 && (
        <div className={placement === "leading" ? "mb-1.5" : "mt-1.5"}>
          <div className="space-y-px">
            {display.visibleRenderableToolEntries.map((workEntry) => (
              <SimpleWorkEntryRow
                key={`${placement}-tool-row:${row.message.id}:${workEntry.id}`}
                workEntry={workEntry}
                chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                textFontSizePx={normalizedChatFontSizePx}
                density="compact"
                fileDiffStatByPath={fileDiffStatByPath}
                markdownCwd={markdownCwd}
                onImageExpand={onImageExpand}
                onOpenTurnDiff={onOpenTurnDiff}
                onOpenToolDetails={openToolDetails}
                {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
                {...(onOpenThread ? { onOpenThread } : {})}
                {...(onOpenAutomation ? { onOpenAutomation } : {})}
                {...(turnSummary?.turnId ? { turnId: turnSummary.turnId } : {})}
              />
            ))}
          </div>
          {display.toolGroupId && display.toolEntries.length > MAX_VISIBLE_INLINE_TOOL_ENTRIES && (
            <div className="py-0.5">
              <button
                type="button"
                className="text-muted-foreground/50 transition-colors duration-150 hover:text-foreground/72"
                style={{ fontSize: `${normalizedChatFontSizePx}px` }}
                onClick={() => handleToggleWorkGroup(display.toolGroupId!)}
              >
                {display.toolExpanded ? "Show less" : `+${display.hiddenToolCount} more tool calls`}
              </button>
            </div>
          )}
        </div>
      )}
      {!hasCollapsedWork && display.statusEntries.length > 0 && (
        <div className={cn("space-y-0.5", placement === "leading" ? "mb-2" : "mt-2")}>
          {display.statusEntries.map((workEntry) => (
            <SimpleWorkEntryRow
              key={`${placement}-status-row:${row.message.id}:${workEntry.id}`}
              workEntry={workEntry}
              chatMetaFontSizePx={appTypographyScale.chatMetaPx}
              textFontSizePx={normalizedChatFontSizePx}
              density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
              markdownCwd={markdownCwd}
              onImageExpand={onImageExpand}
              onOpenToolDetails={openToolDetails}
              {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
              {...(onOpenThread ? { onOpenThread } : {})}
              {...(onOpenAutomation ? { onOpenAutomation } : {})}
            />
          ))}
        </div>
      )}
    </>
  );
  const renderCollapsedTurnItem = (item: CollapsedTurnItem, keyPrefix: string) => (
    <SimpleWorkEntryRow
      key={`${keyPrefix}:work:${row.message.id}:${item.id}`}
      workEntry={item.entry}
      chatMetaFontSizePx={appTypographyScale.chatMetaPx}
      textFontSizePx={normalizedChatFontSizePx}
      density={prefersCompactWorkEntryRow(item.entry) ? "compact" : "default"}
      markdownCwd={markdownCwd}
      onImageExpand={onImageExpand}
      onOpenToolDetails={openToolDetails}
      {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
      {...(onOpenThread ? { onOpenThread } : {})}
      {...(onOpenAutomation ? { onOpenAutomation } : {})}
    />
  );
  return (
    <>
      {settledCollapseTransition && (
        <div
          aria-hidden="true"
          inert
          // The clone is visual-only for the entire close transition; keep it inert
          // even while the inner DisclosureRegion starts open for its first frame.
          className="pointer-events-none mb-3 select-none"
          data-settled-turn-collapse-transition="true"
        >
          <DisclosureRegion
            open={settledCollapseTransition.open}
            contentClassName="space-y-1.5 pb-2.5"
          >
            {settledCollapseTransition.items.map((item) =>
              renderCollapsedTurnItem(item, "settling-turn-close"),
            )}
          </DisclosureRegion>
        </div>
      )}
      {hasCollapsedWork && (
        <div className="mb-3">
          <Collapsible
            className="group/collapsed-work"
            open={isCollapsedWorkExpanded}
            onOpenChange={(open) => {
              setCollapsedWorkExpanded(row.message.id, open);
            }}
          >
            <CollapsibleTrigger
              // ChatView's click anchor preserves this trigger's screen position
              // while the disclosure height animates, so opening it should not tail-scroll.
              // -ml-0.5 optically aligns the leading "W" with the reply
              // text below: the box is already flush, but the W glyph
              // carries a left side-bearing that reads as an inset.
              className="-ml-0.5 inline-flex items-center gap-1 pb-2 text-left text-muted-foreground/70 transition-colors duration-200 hover:text-muted-foreground/90"
              style={{ fontSize: chatTypographyStyle.fontSize }}
            >
              <span>
                {row.collapsedWorkElapsed ? `Worked for ${row.collapsedWorkElapsed}` : "Details"}
              </span>
              <DisclosureChevron
                open={isCollapsedWorkExpanded}
                className="text-muted-foreground/55"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div
                className={disclosureContentClassName(
                  isCollapsedWorkExpanded,
                  "mb-2.5 space-y-1.5",
                )}
              >
                {collapsedTurnItems!.map((item) =>
                  renderCollapsedTurnItem(item, "collapsed-panel"),
                )}
              </div>
            </CollapsiblePanel>
          </Collapsible>
          <div className="h-px w-full bg-border" />
        </div>
      )}
      <div className="group min-w-0 py-0.5">
        {renderWorkDisplay(leadingWorkDisplay, "leading")}
        {messageText !== null ? (
          <div data-assistant-message-id={row.message.id}>
            <ChatMarkdown
              text={messageText}
              cwd={markdownCwd}
              isStreaming={Boolean(row.message.streaming)}
              style={chatTypographyStyle}
              onImageExpand={onImageExpand}
              markers={messageMarkers}
              visualizationThreadId={!row.message.streaming ? threadId : undefined}
              visualizationMessageId={
                threadId && !row.message.streaming ? row.message.id : undefined
              }
              onVisualizationFollowUp={onVisualizationFollowUp}
            />
          </div>
        ) : null}
        {renderWorkDisplay(inlineWorkDisplay, "inline")}
        {inlineEditedFilesFromTurnSummary.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {inlineEditedFilesFromTurnSummary.map((file) => (
              <button
                key={`inline-summary-edit:${row.message.id}:${file.path}`}
                type="button"
                className="group/file-row flex w-full max-w-full items-center gap-2 px-0 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none"
                title={file.path}
                onClick={() => onOpenTurnDiff(turnSummary!.turnId, file.path)}
              >
                <EditedFileRowContent
                  filePath={file.path}
                  additions={file.additions}
                  deletions={file.deletions}
                  fontSizePx={normalizedChatFontSizePx}
                  compact={false}
                />
              </button>
            ))}
          </div>
        )}
        {(showPinToggle || assistantCopyState.visible || assistantMeta.length > 0) && (
          <div
            className="mt-0.5 flex items-center gap-2 font-system-ui font-normal text-muted-foreground/45"
            style={chatMessageFooterStyle}
          >
            {showPinToggle ? (
              // Pin sits at the left edge of the footer, before the copy action. It stays
              // visible when pinned so it reads as a persistent "this is pinned" marker; an
              // unpinned message only reveals it on hover, like the other footer actions.
              // Same Central pin glyph in both states — persistence signals the pinned state.
              <MessageActionButton
                label={
                  messagePinned ? "Remove message from Highlights" : "Pin message to Highlights"
                }
                tooltip={messagePinned ? "Remove from Highlights" : "Pin to Highlights"}
                aria-pressed={messagePinned}
                className={
                  messagePinned ? "text-muted-foreground/80" : MESSAGE_HOVER_REVEAL_CLASS_NAME
                }
                onClick={() => onTogglePinMessage?.(row.message.id)}
              >
                <PinIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
              </MessageActionButton>
            ) : null}
            {assistantCopyState.visible ? (
              <MessageCopyButton
                text={assistantCopyState.text ?? ""}
                className={MESSAGE_HOVER_REVEAL_CLASS_NAME}
              />
            ) : null}
            {assistantMeta.length > 0 ? (
              <p className={cn("tabular-nums", MESSAGE_HOVER_REVEAL_CLASS_NAME)}>{assistantMeta}</p>
            ) : null}
          </div>
        )}
        <SettledTurnChangedFiles
          turnSummary={turnSummary}
          assistantTurnInProgress={Boolean(row.assistantTurnInProgress)}
          chatTypographyStyle={chatTypographyStyle}
          expandedFileChangesByTurnId={expandedFileChangesByTurnId}
          expandedFileListByTurnId={expandedFileListByTurnId}
          isTailContentRow={isTailContentRow}
          onOpenTurnDiff={onOpenTurnDiff}
          onUndoTurnFiles={onUndoTurnFiles}
          resolvedTheme={resolvedTheme}
          scrollTailExpansionToEnd={scrollTailExpansionToEnd}
          toggleFileChangesExpanded={toggleFileChangesExpanded}
          toggleFileListExpanded={toggleFileListExpanded}
        />
      </div>
    </>
  );
}
