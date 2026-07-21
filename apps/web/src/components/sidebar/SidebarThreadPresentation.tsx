// FILE: SidebarThreadPresentation.tsx
// Purpose: Present provider, subagent, terminal, worktree, automation, and PR state in sidebar rows.
// Layer: Web sidebar presentation

import {
  CheckCircle2Icon,
  ClockIcon,
  TerminalIcon,
  type LucideIcon,
  WorktreeIcon,
} from "~/lib/icons";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
  type PrStatePresentation,
} from "~/components/pullRequest/pullRequestStatePresentation";
import { FiGitBranch } from "react-icons/fi";
import { GoRepoForked } from "react-icons/go";
import { useMemo, type MouseEvent, type ReactNode } from "react";
import {
  type AutomationDefinition,
  type GitStatusResult,
  type ProviderKind,
  type ThreadId,
} from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { formatCadence } from "../../routes/-automations.shared";
import { resolveThreadEnvironmentPresentation } from "../../lib/threadEnvironment";
import { resolveThreadHandoffBadgeLabel } from "../../lib/threadHandoff";
import { resolveSubagentPresentationForThread } from "../../lib/subagentPresentation";
import { createThreadSelector } from "../../storeSelectors";
import { useStore } from "../../store";
import type { Thread } from "../../types";
import { sidebarHoverRevealHideClassName } from "../../sidebarRowStyles";
import { cn } from "../../lib/utils";
import { ProviderIcon } from "../ProviderIcon";
import { SidebarGlyph, sidebarGlyphClass, SIDEBAR_TRAILING_ICON_CLASS } from "../sidebarGlyphs";
import { ThreadRunningSpinner } from "../ThreadRunningSpinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ThreadStatusPill } from "../Sidebar.logic";

function WorktreeBadgeGlyph({ className }: { className?: string }) {
  return <WorktreeIcon aria-hidden="true" className={sidebarGlyphClass("meta", className)} />;
}

export function SidebarStatusTrailingGlyph({ status }: { status: ThreadStatusPill }) {
  if (status.label === "Completed") {
    return (
      <CheckCircle2Icon
        aria-hidden="true"
        className={cn(SIDEBAR_TRAILING_ICON_CLASS, status.colorClass)}
      />
    );
  }
  if (status.pulse) {
    return <ThreadRunningSpinner />;
  }
  return (
    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} />
  );
}

export function ProjectRunIndicatorDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      title="Dev server running"
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-emerald-400 motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

export const THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME = cn(
  "flex shrink-0 items-center",
  sidebarHoverRevealHideClassName("thread-row"),
);

export function threadRowTimestampSlotClassName(
  isSubagentThread: boolean,
  toneClassName?: string,
): string {
  return cn(
    "flex shrink-0 items-center justify-end leading-none tabular-nums",
    sidebarHoverRevealHideClassName("thread-row"),
    isSubagentThread
      ? "w-[1.2rem] text-[10px]"
      : "w-[1.625rem] text-[length:calc(var(--app-font-size-ui-meta,11px)+0.5px)]",
    toneClassName ?? (isSubagentThread ? "text-muted-foreground/26" : "text-muted-foreground/38"),
  );
}

export type ThreadMetaChip = {
  id: "automation" | "handoff" | "fork" | "worktree";
  tooltip: string;
  icon: ReactNode;
};

export function resolveThreadRowMetaChips(input: {
  thread: Pick<
    Thread,
    "forkSourceThreadId" | "sidechatSourceThreadId" | "envMode" | "worktreePath" | "handoff"
  >;
  includeHandoffBadge: boolean;
  handoffShownInAvatar?: boolean;
  threadAutomations?: readonly AutomationDefinition[] | undefined;
}): ThreadMetaChip[] {
  const chips: ThreadMetaChip[] = [];
  const isSidechatThread = Boolean(input.thread.sidechatSourceThreadId);
  const threadAutomations = input.threadAutomations;
  if (threadAutomations && threadAutomations.length > 0) {
    const anyEnabled = threadAutomations.some((automation) => automation.enabled);
    const firstAutomation = threadAutomations[0]!;
    const tooltip =
      threadAutomations.length === 1
        ? `${firstAutomation.name} · ${
            firstAutomation.enabled ? formatCadence(firstAutomation.schedule) : "Paused"
          }`
        : `${threadAutomations.length} automations`;
    chips.push({
      id: "automation",
      tooltip,
      icon: (
        <SidebarGlyph
          icon={ClockIcon}
          variant="meta"
          className={anyEnabled ? "text-muted-foreground/55" : "text-muted-foreground/40"}
        />
      ),
    });
  }

  const handoffBadgeLabel = resolveThreadHandoffBadgeLabel(input.thread);
  if (input.includeHandoffBadge && !input.handoffShownInAvatar && handoffBadgeLabel) {
    chips.push({
      id: "handoff",
      tooltip: handoffBadgeLabel,
      icon: <SidebarGlyph icon={FiGitBranch} variant="meta" className="text-muted-foreground/55" />,
    });
  }
  if (input.thread.forkSourceThreadId && !isSidechatThread) {
    chips.push({
      id: "fork",
      tooltip: "Forked thread",
      icon: (
        <SidebarGlyph
          icon={GoRepoForked}
          variant="meta"
          className="text-emerald-600 dark:text-emerald-300/90"
        />
      ),
    });
  }

  const worktreeBadgeLabel = resolveThreadEnvironmentPresentation({
    envMode: input.thread.envMode,
    worktreePath: input.thread.worktreePath,
  }).worktreeBadgeLabel;
  if (worktreeBadgeLabel) {
    chips.push({
      id: "worktree",
      tooltip: worktreeBadgeLabel,
      icon: <WorktreeBadgeGlyph className="text-muted-foreground/55" />,
    });
  }
  return chips;
}

export interface TerminalStatusIndicator {
  label: "Terminal input needed" | "Terminal task completed" | "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

export function ProviderAvatarWithTerminal({
  provider,
  handoffSourceProvider,
  handoffTooltip,
  terminalStatus,
  terminalCount,
}: {
  provider: ProviderKind;
  handoffSourceProvider?: ProviderKind | null;
  handoffTooltip?: string | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalCount: number;
}) {
  const showBadge = terminalCount > 1 || terminalStatus !== null;
  const badgeTooltip =
    terminalCount > 1
      ? `${terminalCount} ${pluralize(terminalCount, "terminal")} open`
      : (terminalStatus?.label ?? "Terminal open");
  const badgeColorClass = terminalStatus?.colorClass ?? "text-muted-foreground/55";
  const hasHandoff = Boolean(handoffSourceProvider);
  const containerClass = hasHandoff
    ? "relative inline-flex h-3 w-4.5 shrink-0 items-center"
    : "relative inline-flex size-3 shrink-0 items-center justify-center";
  const avatarNode = hasHandoff ? (
    <span className={containerClass}>
      <span className="sidebar-icon-chip absolute left-0 top-1/2 inline-flex size-3 -translate-y-1/2 items-center justify-center rounded-full">
        <ProviderIcon provider={handoffSourceProvider!} className="size-2" />
      </span>
      <span className="sidebar-icon-chip absolute right-0 top-1/2 z-10 inline-flex size-3 -translate-y-1/2 items-center justify-center rounded-full">
        <ProviderIcon provider={provider} className="size-2" />
      </span>
    </span>
  ) : (
    <span className={containerClass}>
      <ProviderIcon provider={provider} className="size-3" />
    </span>
  );
  const wrappedAvatar =
    hasHandoff && handoffTooltip ? (
      <Tooltip>
        <TooltipTrigger render={avatarNode} />
        <TooltipPopup side="top">{handoffTooltip}</TooltipPopup>
      </Tooltip>
    ) : (
      avatarNode
    );

  return (
    <span className="relative inline-flex shrink-0 items-center">
      {wrappedAvatar}
      {showBadge ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={badgeTooltip}
                className="sidebar-icon-chip absolute -top-1.5 -right-1.5 inline-flex size-3 min-w-3 items-center justify-center rounded-full px-px"
              >
                {terminalCount > 1 ? (
                  <span
                    className={cn(
                      "text-[8px] font-semibold leading-none tabular-nums",
                      badgeColorClass,
                    )}
                  >
                    {terminalCount}
                  </span>
                ) : (
                  <TerminalIcon className={cn("size-2.5", badgeColorClass)} />
                )}
              </span>
            }
          />
          <TooltipPopup side="top">{badgeTooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

function renderSubagentLabel(input: {
  threadId: string;
  parentThreadId?: string | null | undefined;
  agentId?: string | null | undefined;
  nickname?: string | null | undefined;
  role?: string | null | undefined;
  title?: string | null | undefined;
  threads?: ReadonlyArray<Thread> | undefined;
  titleClassName?: string | undefined;
  roleClassName?: string | undefined;
}) {
  const presentation = resolveSubagentPresentationForThread({
    thread: {
      id: input.threadId,
      parentThreadId: input.parentThreadId,
      subagentAgentId: input.agentId,
      subagentNickname: input.nickname,
      subagentRole: input.role,
      title: input.title,
    },
    threads: input.threads,
  });
  const supportingLabel =
    presentation.role ??
    (presentation.nickname && presentation.title && presentation.title !== presentation.nickname
      ? presentation.title
      : null);
  return (
    <span className="min-w-0 truncate">
      <span
        className={cn("font-medium", input.titleClassName)}
        style={{ color: presentation.accentColor }}
      >
        {presentation.nickname ?? presentation.primaryLabel}
      </span>
      {supportingLabel ? (
        <span className={cn("ml-1 text-muted-foreground/48", input.roleClassName)}>
          {presentation.role ? `(${presentation.role})` : supportingLabel}
        </span>
      ) : null}
    </span>
  );
}

export function SidebarSubagentLabel(props: {
  threadId: ThreadId;
  parentThreadId?: ThreadId | null | undefined;
  agentId?: string | null | undefined;
  nickname?: string | null | undefined;
  role?: string | null | undefined;
  title?: string | null | undefined;
  titleClassName?: string | undefined;
  roleClassName?: string | undefined;
}) {
  const selectParentThread = useMemo(
    () => createThreadSelector(props.parentThreadId ?? null),
    [props.parentThreadId],
  );
  const parentThread = useStore(selectParentThread);
  return renderSubagentLabel({
    threadId: props.threadId,
    parentThreadId: props.parentThreadId,
    agentId: props.agentId,
    nickname: props.nickname,
    role: props.role,
    title: props.title,
    threads: parentThread ? [parentThread] : undefined,
    titleClassName: props.titleClassName,
    roleClassName: props.roleClassName,
  });
}

export type ThreadPr = GitStatusResult["pr"];

export function toThreadPr(
  pr:
    | NonNullable<ThreadPr>
    | {
        number: number;
        title: string;
        url: string;
        baseBranch: string;
        headBranch: string;
        state: "open" | "closed" | "merged";
        isDraft?: boolean | undefined;
        mergeability?: "mergeable" | "conflicting" | "unknown" | undefined;
        additions?: number | null | undefined;
        deletions?: number | null | undefined;
        changedFiles?: number | null | undefined;
      },
): ThreadPr {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseBranch,
    headBranch: pr.headBranch,
    state: pr.state,
    isDraft: pr.isDraft ?? false,
    mergeability: pr.mergeability ?? "unknown",
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changedFiles ?? null,
  };
}

export function terminalStatusFromThreadState(input: {
  runningTerminalIds: string[];
  terminalAttentionStatesById: Record<string, "attention" | "review">;
}): TerminalStatusIndicator | null {
  const terminalAttentionStates = Object.values(input.terminalAttentionStatesById ?? {});
  if (terminalAttentionStates.includes("attention")) {
    return {
      label: "Terminal input needed",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      pulse: false,
    };
  }
  if ((input.runningTerminalIds?.length ?? 0) > 0) {
    return {
      label: "Terminal process running",
      colorClass: "text-teal-600 dark:text-teal-300/90",
      pulse: true,
    };
  }
  if (terminalAttentionStates.includes("review")) {
    return {
      label: "Terminal task completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      pulse: false,
    };
  }
  return null;
}

interface PrStatusIndicator {
  label: PrStatePresentation["label"];
  colorClass: string;
  icon: LucideIcon;
  tooltip: string;
  url: string;
}

export function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;
  const presentation = resolvePrStatePresentation(pr);
  return {
    label: presentation.label,
    colorClass: presentation.colorClass,
    icon: PR_STATE_PRESENTATION_ICONS[presentation.iconKind],
    tooltip: `#${pr.number} ${presentation.label}: ${pr.title}`,
    url: pr.url,
  };
}

export function ThreadPrStatusBadge({
  prStatus,
  onOpen,
  className,
}: {
  prStatus: PrStatusIndicator;
  onOpen: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={prStatus.tooltip}
            className={cn(
              "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-ring",
              prStatus.colorClass,
              className,
            )}
            onClick={(event) => onOpen(event, prStatus.url)}
          >
            <SidebarGlyph icon={prStatus.icon} variant="meta" className="size-3.5" />
          </button>
        }
      />
      <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
    </Tooltip>
  );
}
