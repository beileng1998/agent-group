// FILE: MessagesTimeline.userRow.tsx
// Purpose: Render one sent user-message row with attachments and actions.
// Layer: Web chat timeline presentation

import type { MessageId } from "@agent-group/contracts";
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { ClockIcon, NewThreadIcon, SteerIcon, Undo2Icon, type LucideIcon } from "~/lib/icons";
import { deriveDisplayedUserMessageState } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import type { TimestampFormat } from "../../appSettings";
import { formatShortTimestamp } from "../../timestampFormat";
import type { ChatAssistantSelectionAttachment } from "../../types";
import { AssistantSelectionsSummaryChip } from "./AssistantSelectionsSummaryChip";
import { FileAttachmentChip } from "./FileAttachmentChip";
import { FileCommentsSummaryChip } from "./FileCommentsSummaryChip";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { MessageActionButton, MESSAGE_ACTION_ICON_CLASS_NAME } from "./MessageActionButton";
import { MessageCopyButton } from "./MessageCopyButton";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { MESSAGE_HOVER_REVEAL_CLASS_NAME } from "./MessagesTimeline.styles";
import {
  hasOnlyInlineSkillChips,
  UserImageAttachmentThumbnail,
  UserMessageBody,
  UserMessageCollapsibleText,
  UserMessageEditForm,
} from "./MessagesTimeline.userMessage";
import { UserMessagePastedTextCard } from "./PastedTextChip";
import {
  getChatTranscriptUserMessageTextStyle,
  USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
} from "./chatTypography";
import {
  hasLeadingUserMedia,
  resolveUserTurnMarker,
  type UserTurnMarkerKind,
} from "./userTurnMarker";

type TimelineMessage = Extract<MessagesTimelineRow, { kind: "message" }>["message"];
type UserMessageRow = Extract<MessagesTimelineRow, { kind: "message" }>;

const USER_TURN_MARKER_PRESENTATION: Record<
  UserTurnMarkerKind,
  { readonly Icon: LucideIcon; readonly label: string }
> = {
  automation: { Icon: ClockIcon, label: "Sent via Automation" },
  steer: { Icon: SteerIcon, label: "Steering conversation" },
};

function UserDispatchModeChip(props: {
  dispatchMode: TimelineMessage["dispatchMode"];
  dispatchOrigin: TimelineMessage["dispatchOrigin"];
  hasLeadingMedia: boolean;
}) {
  const markerKind = resolveUserTurnMarker(props);
  if (!markerKind) return null;
  const { Icon, label } = USER_TURN_MARKER_PRESENTATION[markerKind];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 self-end px-0 text-[11px] font-normal tracking-[0.01em] text-muted-foreground/78",
        props.hasLeadingMedia ? "mb-3" : "mb-1.5",
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground/75" />
      <span>{label}</span>
    </div>
  );
}

export interface UserMessageRowContext {
  activeChatFontSizePx: number;
  cancelUserMessageEdit: () => void;
  chatMessageFooterStyle: CSSProperties;
  editingUserMessageId: MessageId | null;
  expandedUserMessagesById: Record<string, boolean>;
  isRevertingCheckpoint: boolean;
  isWorking: boolean;
  latestEditableUserMessageId: MessageId | null;
  markdownCwd: string | undefined;
  onEditUserMessage?:
    | ((messageId: MessageId, text: string) => boolean | Promise<boolean>)
    | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenAssistantSelection?: ((selection: ChatAssistantSelectionAttachment) => void) | undefined;
  onRevertUserMessage: (messageId: MessageId) => void;
  resolvedTheme: "light" | "dark";
  scrollTailExpansionToEnd: () => void;
  setExpandedUserMessagesById: Dispatch<SetStateAction<Record<string, boolean>>>;
  startUserMessageEdit: (messageId: MessageId) => void;
  submitUserMessageEdit: (messageId: MessageId, text: string) => Promise<void>;
  submittingEditedUserMessageId: MessageId | null;
  tailContentRowId: string | null;
  timestampFormat: TimestampFormat;
}

const ignoreTimelineImageLoad = () => {};

export function renderUserMessageRow(
  row: UserMessageRow,
  context: UserMessageRowContext,
): ReactNode {
  const {
    activeChatFontSizePx: normalizedChatFontSizePx,
    cancelUserMessageEdit,
    chatMessageFooterStyle,
    editingUserMessageId,
    expandedUserMessagesById,
    isRevertingCheckpoint,
    isWorking,
    latestEditableUserMessageId,
    markdownCwd,
    onEditUserMessage,
    onImageExpand,
    onOpenAssistantSelection,
    onRevertUserMessage,
    resolvedTheme,
    scrollTailExpansionToEnd,
    setExpandedUserMessagesById,
    startUserMessageEdit,
    submitUserMessageEdit,
    submittingEditedUserMessageId,
    tailContentRowId,
    timestampFormat,
  } = context;
  const userMessageTypographyStyle =
    getChatTranscriptUserMessageTextStyle(normalizedChatFontSizePx);
  const userImages = (row.message.attachments ?? []).filter(
    (
      attachment,
    ): attachment is Extract<
      NonNullable<TimelineMessage["attachments"]>[number],
      { type: "image" }
    > => attachment.type === "image",
  );
  const assistantSelections = (row.message.attachments ?? []).filter(
    (
      attachment,
    ): attachment is Extract<
      NonNullable<TimelineMessage["attachments"]>[number],
      { type: "assistant-selection" }
    > => attachment.type === "assistant-selection",
  );
  const userFiles = (row.message.attachments ?? []).filter(
    (
      attachment,
    ): attachment is Extract<
      NonNullable<TimelineMessage["attachments"]>[number],
      { type: "file" }
    > => attachment.type === "file",
  );
  const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text, {
    hideImageOnlyBootstrapPrompt:
      userImages.length > 0 || userFiles.length > 0 || assistantSelections.length > 0,
  });
  const renderedAssistantSelections =
    assistantSelections.length > 0
      ? assistantSelections
      : displayedUserMessage.assistantSelections.map((selection, index) => ({
          type: "assistant-selection" as const,
          id: `fallback-selection-${row.message.id}-${index}`,
          assistantMessageId: selection.assistantMessageId,
          text: selection.text,
        }));
  const terminalContexts = displayedUserMessage.contexts;
  const renderedFileComments = displayedUserMessage.fileComments;
  const renderedPastedTexts = displayedUserMessage.pastedTexts;
  const userMessageText = displayedUserMessage.visibleText;
  const userMessageExpanded = expandedUserMessagesById[row.message.id] ?? false;
  const showUserText = userMessageText.trim().length > 0 || terminalContexts.length > 0;
  const bubbleIsChipOnly =
    showUserText &&
    terminalContexts.length === 0 &&
    hasOnlyInlineSkillChips(userMessageText, row.message.mentions ?? []);
  const canRevertAgentWork = typeof row.revertTurnCount === "number";
  const isEditingThisMessage = editingUserMessageId === row.message.id;
  const isSubmittingThisEdit = submittingEditedUserMessageId === row.message.id;
  const showEditUserMessage =
    Boolean(onEditUserMessage) &&
    row.message.id === latestEditableUserMessageId &&
    displayedUserMessage.copyText.trim().length > 0;
  const hasLeadingMedia = hasLeadingUserMedia({
    imageCount: userImages.length,
    fileCount: userFiles.length,
    assistantSelectionCount: renderedAssistantSelections.length,
    fileCommentCount: renderedFileComments.length,
    pastedTextCount: renderedPastedTexts.length,
  });
  const isTailContentRow = row.id === tailContentRowId;
  return (
    <div className="flex w-full justify-end">
      <div
        className={cn(
          "group flex flex-col items-end gap-px",
          isEditingThisMessage ? "w-full max-w-full" : "max-w-[80%]",
        )}
      >
        {/* Keep user-message chrome outside the bubble so the message reads as one simple block. */}
        <UserDispatchModeChip
          dispatchMode={row.message.dispatchMode}
          dispatchOrigin={row.message.dispatchOrigin}
          hasLeadingMedia={hasLeadingMedia}
        />
        {renderedAssistantSelections.length > 0 && (
          <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
            <AssistantSelectionsSummaryChip
              selections={renderedAssistantSelections}
              {...(onOpenAssistantSelection ? { onOpenSelection: onOpenAssistantSelection } : {})}
            />
          </div>
        )}
        {renderedFileComments.length > 0 && (
          <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
            <FileCommentsSummaryChip comments={renderedFileComments} />
          </div>
        )}
        {renderedPastedTexts.length > 0 && (
          <div className="mb-1 flex max-w-full flex-col items-end gap-1.5 self-end">
            {renderedPastedTexts.map((pasted) => (
              <UserMessagePastedTextCard
                key={pasted.index}
                text={pasted.text}
                metrics={{ lineCount: pasted.lineCount, charCount: pasted.charCount }}
              />
            ))}
          </div>
        )}
        {userFiles.length > 0 && (
          <div className="mb-1 flex max-w-[280px] flex-wrap justify-end gap-1.5 self-end">
            {userFiles.map((file) => (
              <FileAttachmentChip key={file.id} file={file} />
            ))}
          </div>
        )}
        {userImages.length > 0 && (
          <div
            className={cn(
              "flex max-w-[240px] flex-wrap justify-end gap-2 self-end",
              showUserText && "mb-1",
            )}
          >
            {userImages.map((image) => (
              <UserImageAttachmentThumbnail
                key={image.id}
                image={image}
                userImages={userImages}
                onImageExpand={onImageExpand}
                onTimelineImageLoad={
                  isTailContentRow ? scrollTailExpansionToEnd : ignoreTimelineImageLoad
                }
                resolvedTheme={resolvedTheme}
              />
            ))}
          </div>
        )}
        {isEditingThisMessage ? (
          <UserMessageEditForm
            key={row.message.id}
            initialValue={displayedUserMessage.copyText}
            disabled={isSubmittingThisEdit || isRevertingCheckpoint}
            chatTypographyStyle={userMessageTypographyStyle}
            onCancel={cancelUserMessageEdit}
            onSubmit={(text) => void submitUserMessageEdit(row.message.id, text)}
          />
        ) : showUserText ? (
          <div
            className={cn(
              "w-max max-w-full min-w-0 self-end bg-[var(--app-user-message-background)]",
              USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
              bubbleIsChipOnly ? "py-0.5 px-3" : USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
            )}
          >
            <UserMessageCollapsibleText
              text={userMessageText}
              expanded={userMessageExpanded}
              chatFontSizePx={normalizedChatFontSizePx}
              onToggle={() => {
                setExpandedUserMessagesById((previous) => ({
                  ...previous,
                  [row.message.id]: !(previous[row.message.id] ?? false),
                }));
              }}
            >
              <UserMessageBody
                text={userMessageText}
                mentionReferences={row.message.mentions ?? []}
                terminalContexts={terminalContexts}
                chatTypographyStyle={userMessageTypographyStyle}
                resolvedTheme={resolvedTheme}
                markdownCwd={markdownCwd}
              />
            </UserMessageCollapsibleText>
          </div>
        ) : null}
        {!isEditingThisMessage && (
          <div
            className="flex items-center justify-end gap-2 pr-0.5 font-system-ui font-normal text-muted-foreground/45"
            style={chatMessageFooterStyle}
          >
            <p className={cn("tabular-nums", MESSAGE_HOVER_REVEAL_CLASS_NAME)}>
              {formatShortTimestamp(row.message.createdAt, timestampFormat)}
            </p>
            <div className="flex items-center gap-2">
              {displayedUserMessage.copyText && (
                <MessageCopyButton
                  text={displayedUserMessage.copyText}
                  className={MESSAGE_HOVER_REVEAL_CLASS_NAME}
                />
              )}
              {showEditUserMessage && (
                <MessageActionButton
                  label="Edit message"
                  tooltip="Edit and resend"
                  disabled={isRevertingCheckpoint}
                  className={cn(
                    MESSAGE_HOVER_REVEAL_CLASS_NAME,
                    "disabled:text-muted-foreground/35",
                  )}
                  onClick={() => startUserMessageEdit(row.message.id)}
                >
                  <NewThreadIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                </MessageActionButton>
              )}
              {canRevertAgentWork ? (
                <MessageActionButton
                  label="Revert to this message"
                  tooltip="Revert to this message"
                  disabled={isRevertingCheckpoint || isWorking}
                  className={cn(
                    MESSAGE_HOVER_REVEAL_CLASS_NAME,
                    "disabled:text-muted-foreground/35",
                  )}
                  onClick={() => onRevertUserMessage(row.message.id)}
                >
                  <Undo2Icon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                </MessageActionButton>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
