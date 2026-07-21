// FILE: SidebarPinnedThreadRow.tsx
// Purpose: Render one flattened pinned sidebar thread with project context.
// Layer: Web sidebar presentation

import { TerminalIcon } from "~/lib/icons";
import { isGenericChatThreadTitle } from "@agent-group/shared/chatThreads";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadHandoffBadgeLabel } from "../../lib/threadHandoff";
import { selectThreadTerminalState } from "../../terminalStateStore";
import { cn } from "../../lib/utils";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
} from "../../sidebarRowStyles";
import {
  createSidebarThreadHoverAnchorId,
  resolveThreadRowTrailingReserveClass,
} from "../Sidebar.logic";
import { ProviderAvatarWithTerminal } from "./SidebarThreadPresentation";
import {
  prStatusIndicator,
  resolveThreadRowMetaChips,
  SidebarSubagentLabel,
  terminalStatusFromThreadState,
  ThreadPrStatusBadge,
} from "./SidebarThreadPresentation";
import { SidebarGlyph } from "../sidebarGlyphs";
import { SIDEBAR_HOVER_CARD_TRIGGER_PROPS } from "../sidebarHoverCardStyles";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import {
  SidebarThreadHoverActions,
  SidebarThreadHoverCardPopup,
  SidebarThreadRowTrailingCluster,
  type SidebarThreadRowsOwner,
} from "./SidebarThreadRowShared";

const EMPTY_SHORTCUT_PARTS: readonly string[] = [];

export function SidebarPinnedThreadRow({
  thread,
  owner,
}: {
  readonly thread: SidebarThreadSummary;
  readonly owner: SidebarThreadRowsOwner;
}) {
  const terminalState = selectThreadTerminalState(owner.state.terminalByThreadId, thread.id);
  const threadEntryPoint = terminalState.entryPoint;
  const terminalStatus = terminalStatusFromThreadState({
    runningTerminalIds: terminalState.runningTerminalIds,
    terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
  });
  const project = owner.metadata.projectsById.get(thread.projectId);
  const projectLabel = project ? (project.name ?? project.folderName ?? null) : null;
  const isActive = owner.state.activeThreadId === thread.id;
  const isSubagentThread = Boolean(thread.parentThreadId);
  const rightMetaChips = resolveThreadRowMetaChips({
    thread,
    includeHandoffBadge: true,
    handoffShownInAvatar:
      threadEntryPoint !== "terminal" &&
      !isGenericChatThreadTitle(thread.title) &&
      Boolean(thread.handoff?.sourceProvider),
    threadAutomations: owner.metadata.automationsByThreadId.get(thread.id),
  });
  const threadStatus = owner.metadata.resolveStatus(thread);
  const prStatus = prStatusIndicator(owner.metadata.prByThreadId.get(thread.id) ?? null);
  const leadingPrStatus =
    isSubagentThread || thread.forkSourceThreadId || thread.sidechatSourceThreadId
      ? null
      : prStatus;
  const threadJumpLabel = owner.metadata.jumpLabelByThreadId.get(thread.id) ?? null;
  const threadJumpLabelParts =
    owner.metadata.jumpLabelPartsByThreadId.get(thread.id) ?? EMPTY_SHORTCUT_PARTS;
  const hasTrailingStatusGlyph = Boolean(threadStatus) || Boolean(threadJumpLabel);
  const showThreadProviderAvatar = !isGenericChatThreadTitle(thread.title);
  const hoverAnchorId = createSidebarThreadHoverAnchorId({
    scope: "pinned",
    threadId: thread.id,
  });
  const interaction = owner.actions.interaction;

  return (
    <Tooltip>
      <TooltipTrigger
        {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
        render={
          <div
            data-thread-hover-anchor={hoverAnchorId}
            className="group/thread-row relative w-full"
          />
        }
      >
        {leadingPrStatus ? (
          <ThreadPrStatusBadge
            prStatus={leadingPrStatus}
            onOpen={owner.actions.openPr}
            className="pointer-events-auto absolute left-1.5 top-1/2 z-30 size-5 -translate-y-1/2"
          />
        ) : null}
        <div
          role="button"
          tabIndex={0}
          data-thread-item
          className={cn(
            SIDEBAR_HEADER_ROW_CLASS_NAME,
            "relative gap-1.5 transition-colors",
            leadingPrStatus && "pl-8",
            resolveThreadRowTrailingReserveClass({
              metaChipCount: rightMetaChips.length,
              hasTrailingGlyph: hasTrailingStatusGlyph,
            }),
            isActive
              ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
              : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
          )}
          onPointerDown={(event) => interaction.primeActivation(event, thread.id)}
          onClick={() => interaction.activate(thread.id)}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            interaction.openRename(thread.id);
          }}
          onPointerUp={(event) => interaction.handleRenamePointerUp(event, thread.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              interaction.activate(thread.id);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            void owner.actions.openContextMenu(thread.id, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          {threadEntryPoint === "terminal" ? (
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
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] leading-5",
                isActive ? "text-foreground" : SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
              )}
              data-testid={`thread-title-${thread.id}`}
            >
              {isSubagentThread ? (
                <SidebarSubagentLabel
                  threadId={thread.id}
                  parentThreadId={thread.parentThreadId}
                  agentId={thread.subagentAgentId}
                  nickname={thread.subagentNickname}
                  role={thread.subagentRole}
                  title={thread.title}
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
          {projectLabel ? (
            <span
              className={cn(
                "max-w-[40%] shrink-0 truncate text-right text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/38 transition-[margin] duration-150 ease-out",
                hasTrailingStatusGlyph && "mr-2",
              )}
            >
              {projectLabel}
            </span>
          ) : null}
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
            <SidebarThreadRowTrailingCluster
              isSubagentThread={isSubagentThread}
              threadJumpLabel={threadJumpLabel}
              threadJumpLabelParts={threadJumpLabelParts}
              rightMetaChips={rightMetaChips}
              threadStatus={threadStatus}
              timestampToneClassName="text-muted-foreground/38"
              hoverActions={
                <SidebarThreadHoverActions
                  threadId={thread.id}
                  toneClassName="text-muted-foreground/42"
                  isPinned
                  compact={isSubagentThread}
                  owner={owner}
                />
              }
            />
          </div>
        </div>
      </TooltipTrigger>
      <SidebarThreadHoverCardPopup thread={thread} hoverAnchorId={hoverAnchorId} owner={owner} />
    </Tooltip>
  );
}
