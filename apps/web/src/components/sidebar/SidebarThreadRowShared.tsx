// FILE: SidebarThreadRowShared.tsx
// Purpose: Shared data contract and presentation primitives for sidebar thread rows.
// Layer: Web sidebar presentation

import { HiOutlineArchiveBox } from "react-icons/hi2";
import type { AutomationDefinition, ProjectId, ThreadId } from "@agent-group/contracts";
import type { MouseEvent, ReactNode } from "react";
import { formatRelativeTime } from "../../lib/relativeTime";
import type { SidebarThreadInteractionOwner } from "../../hooks/useSidebarThreadInteractionOwner";
import type { Project, SidebarThreadSummary } from "../../types";
import type { ThreadTerminalState } from "../../terminalStateStore";
import { resolveThreadHoverCardMetadata } from "../Sidebar.logic";
import { ThreadHoverCardContent } from "../ThreadHoverCardContent";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarMetaChipStack } from "../SidebarMetaChip";
import { SidebarRowHoverActions } from "../SidebarRowHoverActions";
import { ThreadPinToggleButton } from "../ThreadPinToggleButton";
import { sidebarGlyphClass, SIDEBAR_TRAILING_ICON_CLASS } from "../sidebarGlyphs";
import {
  SIDEBAR_HOVER_CARD_POPUP_PROPS,
  SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME,
} from "../sidebarHoverCardStyles";
import { createThreadHoverCardAnchor } from "../sidebarHoverCardAnchors";
import { Kbd, KbdGroup } from "../ui/kbd";
import { TooltipPopup } from "../ui/tooltip";
import {
  SidebarStatusTrailingGlyph,
  THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME,
  type ThreadMetaChip,
  type ThreadPr,
  threadRowTimestampSlotClassName,
} from "./SidebarThreadPresentation";
import type { ThreadStatusPill } from "../Sidebar.statusLogic";
import { cn } from "../../lib/utils";

type ThreadInteractionActions = SidebarThreadInteractionOwner["actions"];

export interface SidebarThreadRowsOwner {
  readonly state: {
    readonly activeThreadId: ThreadId | null;
    readonly selectedThreadIds: ReadonlySet<ThreadId>;
    readonly pinnedThreadIds: ReadonlySet<ThreadId>;
    readonly terminalByThreadId: Record<ThreadId, ThreadTerminalState>;
  };
  readonly metadata: {
    readonly projectsById: ReadonlyMap<ProjectId, Project>;
    readonly automationsByThreadId: ReadonlyMap<ThreadId, readonly AutomationDefinition[]>;
    readonly prByThreadId: ReadonlyMap<ThreadId, ThreadPr>;
    readonly jumpLabelByThreadId: ReadonlyMap<ThreadId, string>;
    readonly jumpLabelPartsByThreadId: ReadonlyMap<ThreadId, readonly string[]>;
    readonly resolveStatus: (thread: SidebarThreadSummary) => ThreadStatusPill | null;
    readonly isTemporary: (threadId: ThreadId) => boolean;
  };
  readonly actions: {
    readonly interaction: ThreadInteractionActions;
    readonly archiveWithUndo: (threadId: ThreadId) => Promise<void>;
    readonly togglePinned: (threadId: ThreadId) => void;
    readonly openPr: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
    readonly openContextMenu: (
      threadId: ThreadId,
      position: { readonly x: number; readonly y: number },
    ) => void | Promise<void>;
    readonly openMultiSelectContextMenu: (position: {
      readonly x: number;
      readonly y: number;
    }) => void | Promise<void>;
  };
}

export function SidebarThreadHoverActions({
  threadId,
  toneClassName,
  isPinned,
  compact = false,
  includePinToggle = true,
  owner,
}: {
  readonly threadId: ThreadId;
  readonly toneClassName: string;
  readonly isPinned: boolean;
  readonly compact?: boolean;
  readonly includePinToggle?: boolean;
  readonly owner: SidebarThreadRowsOwner;
}) {
  return (
    <SidebarRowHoverActions threadId={threadId}>
      <div className="pointer-events-auto inline-flex items-center gap-2">
        {includePinToggle ? (
          <ThreadPinToggleButton
            pinned={isPinned}
            presentation="inline"
            toneClassName={toneClassName}
            onToggle={(event) => {
              event.preventDefault();
              event.stopPropagation();
              owner.actions.togglePinned(threadId);
            }}
          />
        ) : null}
        <SidebarIconButton
          icon={HiOutlineArchiveBox}
          label="Archive thread"
          title="Archive thread"
          data-testid={`thread-archive-${threadId}`}
          size={compact ? "sm" : "md"}
          iconClassName={compact ? sidebarGlyphClass("compact") : SIDEBAR_TRAILING_ICON_CLASS}
          className={cn("hover:text-foreground/89", toneClassName)}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void owner.actions.archiveWithUndo(threadId);
          }}
        />
      </div>
    </SidebarRowHoverActions>
  );
}

export function SidebarThreadRowTrailingCluster({
  isSubagentThread,
  threadJumpLabel,
  threadJumpLabelParts,
  rightMetaChips,
  threadStatus,
  timestampToneClassName,
  hoverActions,
}: {
  readonly isSubagentThread: boolean;
  readonly threadJumpLabel: string | null;
  readonly threadJumpLabelParts: readonly string[];
  readonly rightMetaChips: readonly ThreadMetaChip[];
  readonly threadStatus: ThreadStatusPill | null;
  readonly timestampToneClassName?: string;
  readonly hoverActions: ReactNode;
}) {
  return (
    <div className="relative flex shrink-0 items-center justify-end gap-1">
      {rightMetaChips.length > 0 ? (
        <div className={THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME}>
          <SidebarMetaChipStack chips={[...rightMetaChips]} />
        </div>
      ) : null}
      {threadJumpLabel ? (
        <KbdGroup className={THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME}>
          {threadJumpLabelParts.map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
        </KbdGroup>
      ) : null}
      {!threadJumpLabel && threadStatus ? (
        <span className={threadRowTimestampSlotClassName(isSubagentThread, timestampToneClassName)}>
          <SidebarStatusTrailingGlyph status={threadStatus} />
        </span>
      ) : null}
      {hoverActions}
    </div>
  );
}

export function SidebarThreadHoverCardPopup({
  thread,
  hoverAnchorId,
  owner,
}: {
  readonly thread: SidebarThreadSummary;
  readonly hoverAnchorId: string;
  readonly owner: SidebarThreadRowsOwner;
}) {
  const project = owner.metadata.projectsById.get(thread.projectId) ?? null;
  const metadata = resolveThreadHoverCardMetadata({ thread, project });
  return (
    <TooltipPopup
      {...SIDEBAR_HOVER_CARD_POPUP_PROPS}
      viewportClassName="[--viewport-inline-padding:0px] py-0"
      anchor={createThreadHoverCardAnchor(hoverAnchorId)}
      className={cn(SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME, "whitespace-normal leading-tight")}
    >
      <ThreadHoverCardContent
        title={thread.title}
        timeLabel={formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
        projectName={metadata.projectName}
        projectCwd={metadata.projectCwd}
        sourceProjectName={metadata.sourceProjectName}
        branch={metadata.branch}
        worktreeName={metadata.worktreeName}
      />
    </TooltipPopup>
  );
}
