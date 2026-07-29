// FILE: MessagesTimeline.row.tsx
// Purpose: Route each transcript row kind to its focused presentation owner.
// Layer: Web chat timeline presentation

import type { CSSProperties, ReactNode } from "react";
import { CircleAlertIcon, CircleCheckIcon, LoaderIcon, WorktreeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { CHAT_COLUMN_FRAME_CLASS_NAME } from "./composerPickerStyles";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { formatWorkingTimer, WorkingTimer } from "./MessagesTimeline.controllers";
import { MAX_VISIBLE_WORK_LOG_ENTRIES, type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { prefersCompactWorkEntryRow } from "./MessagesTimeline.workEntryModel";
import { SimpleWorkEntryRow } from "./MessagesTimeline.workEntryRow";
import {
  renderAssistantMessageRow,
  type AssistantMessageRowContext,
} from "./MessagesTimeline.assistantRow";
import { renderUserMessageRow, type UserMessageRowContext } from "./MessagesTimeline.userRow";
import type { WorktreeSetupStep } from "../../types";

function WorktreeSetupStepGlyph({ status }: { status: WorktreeSetupStep["status"] }) {
  if (status === "done") {
    return <CircleCheckIcon className="size-2.5 text-[var(--color-text-foreground)]" />;
  }
  if (status === "active") {
    return <LoaderIcon className="size-2.5 animate-spin text-[var(--color-text-foreground)]" />;
  }
  if (status === "error") {
    return <CircleAlertIcon className="size-2.5 text-destructive" />;
  }
  return <span className="block size-2 rounded-full border border-[color:var(--color-border)]" />;
}

function WorktreeSetupCard({ steps }: { steps: ReadonlyArray<WorktreeSetupStep> }) {
  return (
    <div className="w-fit max-w-full rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary)] px-3.5 py-3 font-system-ui shadow-xs">
      <div className="flex items-center gap-2">
        <WorktreeIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground-tertiary)]" />
        <span className="shimmer text-[13px] font-medium text-[var(--color-text-foreground-secondary)]">
          Preparing worktree...
        </span>
      </div>
      <ol className="mt-2 flex flex-col">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="relative flex items-center gap-2.5 py-[3px]">
              {isLast ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[6.5px] top-1/2 h-full w-px",
                    step.status === "done"
                      ? "bg-[var(--color-text-foreground)]"
                      : "bg-[color:var(--color-border)]",
                  )}
                />
              )}
              <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-background-elevated-primary)]">
                <WorktreeSetupStepGlyph status={step.status} />
              </span>
              <span
                className={cn(
                  "text-[13px] leading-5",
                  step.status === "active" || step.status === "done"
                    ? "text-[var(--color-text-foreground)]"
                    : step.status === "error"
                      ? "text-destructive"
                      : "text-[var(--color-text-foreground-tertiary)] opacity-70",
                )}
              >
                {step.label}
                {step.status === "error" ? " — failed" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface MessagesTimelineRowContext {
  appTypographyScale: { chatMetaPx: number; chatPx: number; uiSmPx: number };
  assistant: AssistantMessageRowContext;
  chatTypographyStyle: CSSProperties;
  enteringMessageRowIds: ReadonlySet<string>;
  expandedWorkGroupsState: Record<string, boolean>;
  handleToggleWorkGroup: (groupId: string) => void;
  highlightedMessageId: string | null;
  nowIso?: string | undefined;
  user: UserMessageRowContext;
  workspaceRoot: string | undefined;
}

export function renderMessagesTimelineRow(
  row: MessagesTimelineRow,
  context: MessagesTimelineRowContext,
): ReactNode {
  return (
    <div
      className={cn(
        CHAT_COLUMN_FRAME_CLASS_NAME,
        "px-1 transition-colors duration-500",
        row.kind === "work" ||
          row.kind === "working-header" ||
          (row.kind === "message" && row.message.role === "assistant")
          ? "pb-2"
          : "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        row.kind === "message" && row.message.id === context.highlightedMessageId
          ? "rounded-xl bg-[var(--color-background-elevated-secondary)]"
          : null,
        context.enteringMessageRowIds.has(row.id) ? "chat-message-send-enter" : null,
      )}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" && (
        <div>
          <div className="space-y-0.5">
            {((context.expandedWorkGroupsState[row.id] ?? false)
              ? row.groupedEntries
              : row.groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
            ).map((workEntry) => (
              <SimpleWorkEntryRow
                key={`work-row:${workEntry.id}`}
                workEntry={workEntry}
                chatMetaFontSizePx={context.appTypographyScale.chatMetaPx}
                textFontSizePx={context.assistant.normalizedChatFontSizePx}
                density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
                markdownCwd={context.assistant.markdownCwd}
                onImageExpand={context.assistant.onImageExpand}
                onOpenToolDetails={context.assistant.onOpenToolDetails}
                {...(context.assistant.onOpenAgentActivity
                  ? { onOpenAgentActivity: context.assistant.onOpenAgentActivity }
                  : {})}
                {...(context.assistant.onOpenThread
                  ? { onOpenThread: context.assistant.onOpenThread }
                  : {})}
                {...(context.assistant.onOpenAutomation
                  ? { onOpenAutomation: context.assistant.onOpenAutomation }
                  : {})}
              />
            ))}
          </div>
          {row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES && (
            <div className="mt-1.5 flex items-center justify-start gap-2 px-0.5">
              <button
                type="button"
                className="font-system-ui text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
                style={{ fontSize: `${context.appTypographyScale.uiSmPx}px` }}
                onClick={() => context.handleToggleWorkGroup(row.id)}
              >
                {(context.expandedWorkGroupsState[row.id] ?? false)
                  ? "Show less"
                  : `Show ${row.groupedEntries.length - MAX_VISIBLE_WORK_LOG_ENTRIES} more`}
              </button>
            </div>
          )}
        </div>
      )}
      {row.kind === "message" && row.message.role === "user"
        ? renderUserMessageRow(row, context.user)
        : null}
      {row.kind === "message" && row.message.role === "assistant"
        ? renderAssistantMessageRow(row, context.assistant)
        : null}
      {row.kind === "proposed-plan" && (
        <div className="min-w-0 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={context.assistant.markdownCwd}
            workspaceRoot={context.workspaceRoot}
            chatTypographyStyle={context.chatTypographyStyle}
          />
        </div>
      )}
      {row.kind === "working-header" && (
        <div>
          <div
            className="-ml-0.5 pb-2 text-muted-foreground/70"
            style={{ fontSize: context.chatTypographyStyle.fontSize }}
          >
            Working for{" "}
            {context.nowIso ? (
              (formatWorkingTimer(row.createdAt, context.nowIso) ?? "0s")
            ) : (
              <WorkingTimer createdAt={row.createdAt} />
            )}
          </div>
          <div className="h-px w-full bg-border" />
        </div>
      )}
      {row.kind === "working" && (
        <div
          className="shimmer pt-0.5 text-muted-foreground/70 font-system-ui"
          style={{ fontSize: `${context.appTypographyScale.chatPx}px` }}
        >
          Thinking
        </div>
      )}
      {row.kind === "worktree-setup" && (
        <DisclosureRegion open={row.open}>
          <div className="pt-0.5 pb-1">
            <WorktreeSetupCard steps={row.steps} />
          </div>
        </DisclosureRegion>
      )}
    </div>
  );
}
