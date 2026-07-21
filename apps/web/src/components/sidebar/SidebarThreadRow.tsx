// FILE: SidebarThreadRow.tsx
// Purpose: Render one project, chat, or runtime-subagent thread row in the sidebar.
// Layer: Web sidebar presentation

import { ChevronDownIcon, ChevronRightIcon, TemporaryThreadIcon, TerminalIcon } from "~/lib/icons";
import type { ThreadId } from "@agent-group/contracts";
import { isGenericChatThreadTitle } from "@agent-group/shared/chatThreads";
import { pluralize } from "@agent-group/shared/text";
import { resolveSubagentPresentationForThread } from "../../lib/subagentPresentation";
import { resolveThreadHandoffBadgeLabel } from "../../lib/threadHandoff";
import { SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME } from "../../sidebarRowStyles";
import { selectThreadTerminalState } from "../../terminalStateStore";
import type { SidebarThreadSummary } from "../../types";
import { cn } from "../../lib/utils";
import {
  createSidebarThreadHoverAnchorId,
  resolveThreadRowClassName,
  resolveThreadRowTrailingReserveClass,
} from "../Sidebar.logic";
import { THREAD_DRAG_MIME } from "../chat-drop-overlay/ChatPaneDropOverlay";
import { SidebarGlyph } from "../sidebarGlyphs";
import { SIDEBAR_HOVER_CARD_TRIGGER_PROPS } from "../sidebarHoverCardStyles";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ProviderAvatarWithTerminal,
  prStatusIndicator,
  resolveThreadRowMetaChips,
  SidebarSubagentLabel,
  terminalStatusFromThreadState,
  ThreadPrStatusBadge,
} from "./SidebarThreadPresentation";
import {
  SidebarThreadHoverActions,
  SidebarThreadHoverCardPopup,
  SidebarThreadRowTrailingCluster,
  type SidebarThreadRowsOwner,
} from "./SidebarThreadRowShared";

const EMPTY_SHORTCUT_PARTS: readonly string[] = [];

export interface SidebarThreadRowDescriptor {
  readonly thread: SidebarThreadSummary;
  readonly orderedThreadIds: readonly ThreadId[];
  readonly depth?: number;
  readonly childCount?: number;
  readonly isExpanded?: boolean;
  readonly topLevel?: boolean;
}

export function SidebarThreadRow({
  row,
  owner,
}: {
  readonly row: SidebarThreadRowDescriptor;
  readonly owner: SidebarThreadRowsOwner;
}) {
  const { thread, orderedThreadIds } = row;
  const depth = row.depth ?? 0;
  const childCount = row.childCount ?? 0;
  const isExpanded = row.isExpanded ?? false;
  const topLevel = row.topLevel ?? false;
  const terminalState = selectThreadTerminalState(owner.state.terminalByThreadId, thread.id);
  const threadEntryPoint = terminalState.entryPoint;
  const isActive = owner.state.activeThreadId === thread.id;
  const isPinned = owner.state.pinnedThreadIds.has(thread.id);
  const isSelected = owner.state.selectedThreadIds.has(thread.id);
  const isHighlighted = isActive || isSelected;
  const threadStatus = owner.metadata.resolveStatus(thread);
  const prStatus = prStatusIndicator(owner.metadata.prByThreadId.get(thread.id) ?? null);
  const terminalStatus = terminalStatusFromThreadState({
    runningTerminalIds: terminalState.runningTerminalIds,
    terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
  });
  const isTemporaryThread = owner.metadata.isTemporary(thread.id);
  const secondaryMetaClass = isHighlighted
    ? "text-foreground/54 dark:text-foreground/64"
    : "text-muted-foreground/34";
  const rightMetaChips = resolveThreadRowMetaChips({
    thread,
    includeHandoffBadge: !isTemporaryThread,
    handoffShownInAvatar:
      threadEntryPoint !== "terminal" &&
      !isGenericChatThreadTitle(thread.title) &&
      Boolean(thread.handoff?.sourceProvider),
    threadAutomations: owner.metadata.automationsByThreadId.get(thread.id),
  });
  const isSubagentThread = Boolean(thread.parentThreadId);
  const leadingPrStatus =
    isSubagentThread || thread.forkSourceThreadId || thread.sidechatSourceThreadId
      ? null
      : prStatus;
  const subagentPresentation = isSubagentThread
    ? resolveSubagentPresentationForThread({
        thread: {
          id: thread.id,
          parentThreadId: thread.parentThreadId,
          subagentAgentId: thread.subagentAgentId,
          subagentNickname: thread.subagentNickname,
          subagentRole: thread.subagentRole,
          title: thread.title,
        },
      })
    : null;
  const canToggleSubagents = childCount > 0;
  const subagentIndentPx = Math.max(0, Math.min(depth - 1, 3) * 10);
  const showCompactMeta = !isSubagentThread;
  const threadJumpLabel = owner.metadata.jumpLabelByThreadId.get(thread.id) ?? null;
  const threadJumpLabelParts =
    owner.metadata.jumpLabelPartsByThreadId.get(thread.id) ?? EMPTY_SHORTCUT_PARTS;
  const showThreadProviderAvatar = !isGenericChatThreadTitle(thread.title);
  const childCountLabel = `${childCount} ${pluralize(childCount, "subagent")}`;
  const toggleButtonClassName = isHighlighted
    ? "border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]"
    : "border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground-secondary)] hover:border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]";
  const hoverAnchorId = createSidebarThreadHoverAnchorId({
    scope: topLevel ? "chat" : "project",
    threadId: thread.id,
  });
  const interaction = owner.actions.interaction;

  return (
    <SidebarMenuSubItem
      data-thread-hover-anchor={hoverAnchorId}
      className="group/thread-row w-full"
      data-thread-item
    >
      {leadingPrStatus ? (
        <ThreadPrStatusBadge
          prStatus={leadingPrStatus}
          onOpen={owner.actions.openPr}
          className="pointer-events-auto absolute left-1.5 top-1/2 z-30 size-5 -translate-y-1/2"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
          render={
            <SidebarMenuSubButton
              render={<div role="button" tabIndex={0} />}
              data-thread-entry-point={threadEntryPoint}
              size="sm"
              isActive={isActive}
              className={cn(
                resolveThreadRowClassName({ isActive, isSelected }),
                leadingPrStatus ? "pl-8" : topLevel && !isSubagentThread ? "pl-2" : null,
                isSubagentThread
                  ? "pr-7.5"
                  : resolveThreadRowTrailingReserveClass({
                      metaChipCount: showCompactMeta ? rightMetaChips.length : 0,
                      hasTrailingGlyph: Boolean(threadStatus) || Boolean(threadJumpLabel),
                    }),
              )}
              draggable
              onDragStart={(event) => {
                const dragImage = event.currentTarget as HTMLElement | null;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  THREAD_DRAG_MIME,
                  JSON.stringify({ threadId: thread.id }),
                );
                if (dragImage) {
                  const rect = dragImage.getBoundingClientRect();
                  event.dataTransfer.setDragImage(
                    dragImage,
                    Math.max(0, event.clientX - rect.left),
                    Math.max(0, event.clientY - rect.top),
                  );
                }
              }}
              onClick={(event) => {
                interaction.activateFromClick(event, thread.id, orderedThreadIds, {
                  isActive,
                  canToggleSubagents,
                });
              }}
              onPointerDown={(event) => interaction.primeActivation(event, thread.id)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                interaction.openRename(thread.id);
              }}
              onPointerUp={(event) => interaction.handleRenamePointerUp(event, thread.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                interaction.activate(thread.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (owner.state.selectedThreadIds.size > 0 && isSelected) {
                  void owner.actions.openMultiSelectContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                  });
                } else {
                  if (owner.state.selectedThreadIds.size > 0) {
                    interaction.clearSelection();
                  }
                  void owner.actions.openContextMenu(thread.id, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }
              }}
            />
          }
        >
          {isSubagentThread ? (
            <span
              aria-hidden="true"
              className="relative inline-flex h-3.5 w-[18px] shrink-0 items-center"
              style={{ marginLeft: `${subagentIndentPx}px` }}
            >
              <span className="absolute left-1.5 top-0 bottom-0 w-px rounded-full bg-border/35" />
              <span className="absolute left-1.5 top-1/2 h-px w-2.5 -translate-y-1/2 bg-border/35" />
              <span
                className="absolute left-1.5 top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: subagentPresentation?.accentColor }}
              />
            </span>
          ) : threadEntryPoint === "terminal" ? (
            <SidebarGlyph icon={TerminalIcon} variant="chrome" />
          ) : showThreadProviderAvatar ? (
            <ProviderAvatarWithTerminal
              provider={thread.session?.provider ?? thread.modelSelection.provider}
              handoffSourceProvider={thread.handoff?.sourceProvider ?? null}
              handoffTooltip={resolveThreadHandoffBadgeLabel(thread)}
              terminalStatus={terminalStatus}
              terminalCount={terminalState.terminalIds.length}
            />
          ) : null}
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center text-left",
              isSubagentThread ? "gap-[5px]" : "gap-1.5",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)]",
                isActive ? "text-foreground" : SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
                isSubagentThread ? "leading-[18px] text-foreground/80" : "leading-5",
              )}
            >
              {isSubagentThread ? (
                <SidebarSubagentLabel
                  threadId={thread.id}
                  parentThreadId={thread.parentThreadId}
                  agentId={thread.subagentAgentId}
                  nickname={thread.subagentNickname}
                  role={thread.subagentRole}
                  title={thread.title}
                  roleClassName="text-muted-foreground/42"
                />
              ) : (
                thread.title
              )}
            </span>
            {!isSubagentThread && threadStatus?.label === "Pending Approval" ? (
              <span
                aria-label="Pending approval"
                className={cn("shrink-0 text-[10px] font-medium", threadStatus.colorClass)}
              >
                Pending
              </span>
            ) : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 pr-1">
            {canToggleSubagents ? (
              <button
                type="button"
                data-thread-selection-safe
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${childCountLabel}`}
                title={childCountLabel}
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border px-[5px] transition-colors",
                  toggleButtonClassName,
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  interaction.toggleSubagents(thread.id);
                }}
              >
                <span className="text-[9px] font-medium leading-none tabular-nums">
                  {childCount}
                </span>
                {isExpanded ? (
                  <SidebarGlyph icon={ChevronDownIcon} variant="chevron" />
                ) : (
                  <SidebarGlyph icon={ChevronRightIcon} variant="chevron" />
                )}
              </button>
            ) : null}
            {showCompactMeta && isTemporaryThread && !thread.sidechatSourceThreadId ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex shrink-0 items-center text-muted-foreground/55">
                      <TemporaryThreadIcon />
                    </span>
                  }
                />
                <TooltipPopup side="top">Temporary chat</TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
          <div className={cn("absolute top-1/2 flex -translate-y-1/2 items-center", "right-1.5")}>
            <SidebarThreadRowTrailingCluster
              isSubagentThread={isSubagentThread}
              threadJumpLabel={threadJumpLabel}
              threadJumpLabelParts={threadJumpLabelParts}
              rightMetaChips={showCompactMeta ? rightMetaChips : []}
              threadStatus={threadStatus}
              timestampToneClassName={
                isSubagentThread
                  ? isHighlighted
                    ? "text-foreground/38 dark:text-foreground/46"
                    : "text-muted-foreground/24"
                  : secondaryMetaClass
              }
              hoverActions={
                <SidebarThreadHoverActions
                  threadId={thread.id}
                  toneClassName={secondaryMetaClass}
                  isPinned={isPinned}
                  compact={isSubagentThread}
                  owner={owner}
                />
              }
            />
          </div>
        </TooltipTrigger>
        <SidebarThreadHoverCardPopup thread={thread} hoverAnchorId={hoverAnchorId} owner={owner} />
      </Tooltip>
    </SidebarMenuSubItem>
  );
}
