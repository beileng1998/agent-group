// FILE: MessagesTimeline.workEntryRow.tsx
// Purpose: Render a work entry across tool, file, automation, and subagent variants.
// Layer: Web chat timeline presentation

import { ThreadId, type TurnId } from "@agent-group/contracts";
import { memo, useMemo } from "react";
import { describeLinkChip } from "~/lib/linkChips";
import { GitHubIcon, McpIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { fileDiffStatsByPath, resolveFileDiffStatByChangedPath } from "~/lib/diffRendering";
import ChatMarkdown from "../ChatMarkdown";
import { LinkChipIcon } from "../LinkChipIcon";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../../lib/workspaceFileOpener";
import { extractWebFetchUrl } from "../../lib/toolCallLabel";
import {
  isAgentActivityWorkEntry,
  isCodexActivityStatusWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import { AutomationCreatedCard } from "./AutomationCreatedCard";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  combineWorkEntryDisplayText,
  extractFilePathFromDetail,
  humanizeSubagentStatus,
  isFileChangeWorkEntry,
  isFileReadToolEntry,
  isGitHubMcpToolCall,
  normalizeWorkDisplayText,
  subagentCardMeta,
  subagentCardSummary,
  subagentPrimaryLabel,
  subagentSecondaryLabel,
  subagentStatusClasses,
  toolRowTooltipContent,
  toolWorkEntryHeading,
  workEntryIcon,
  workEntryPreview,
  type TimelineWorkEntry,
} from "./MessagesTimeline.workEntryModel";
import {
  AgentActivityOpenSurface,
  EditedFileRowContent,
  ToolDetailsDisclosure,
  WORK_ROW_MUTED_HOVER_TONE,
} from "./MessagesTimeline.workEntrySurfaces";

const EMPTY_FILE_DIFF_STATS: ReadonlyMap<string, { additions: number; deletions: number }> =
  new Map();

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  chatMetaFontSizePx: number;
  textFontSizePx?: number;
  density?: "default" | "compact";
  fileDiffStatByPath?: ReadonlyMap<string, { additions: number; deletions: number }>;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  turnId?: TurnId;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
  onOpenToolDetails?: (workEntry: TimelineWorkEntry) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  onOpenAutomation?: (automationId: string) => void;
}) {
  const {
    workEntry,
    chatMetaFontSizePx,
    textFontSizePx = chatMetaFontSizePx,
    density = "default",
    fileDiffStatByPath,
    markdownCwd,
    onImageExpand,
    turnId,
    onOpenTurnDiff,
    onOpenToolDetails,
    onOpenAgentActivity,
    onOpenThread,
    onOpenAutomation,
  } = props;
  const compact = density === "compact";
  const isCodexStatusRow = isCodexActivityStatusWorkEntry(workEntry);
  const EntryIcon = workEntryIcon(workEntry);
  // Web-fetch tool calls surface the target site (favicon + URL) instead of the raw
  // `WebFetch: {json}` arguments, reusing the same link-chip icon/label path as
  // composer and markdown links so every site reference looks identical.
  const webFetchUrl = extractWebFetchUrl(workEntry);
  // Standard tool rows keep one discoverable left glyph. Codex status rows
  // deliberately skip it and reuse only the shared tool-label typography.
  const isGitHubToolRow = isGitHubMcpToolCall(workEntry);
  const isMcpToolRow = workEntry.itemType === "mcp_tool_call" && !isGitHubToolRow;
  const LeftIcon = isGitHubToolRow ? GitHubIcon : isMcpToolRow ? McpIcon : EntryIcon;
  const leftIconKind = webFetchUrl
    ? "web-fetch"
    : isGitHubToolRow || EntryIcon === GitHubIcon
      ? "github"
      : isMcpToolRow
        ? "mcp"
        : undefined;
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const displayText = webFetchUrl
    ? describeLinkChip(webFetchUrl).label
    : isReasoningUpdateWorkEntry(workEntry) && preview
      ? preview
      : combineWorkEntryDisplayText(heading, preview);
  const showInlineAgentTaskPreview =
    workEntry.itemType === "collab_agent_tool_call" &&
    (workEntry.subagents?.length ?? 0) === 0 &&
    Boolean(preview) &&
    normalizeWorkDisplayText(heading) !== normalizeWorkDisplayText(preview ?? "");
  const rawCommand = workEntry.rawCommand ?? workEntry.command;
  const hoverText =
    rawCommand ?? (showInlineAgentTaskPreview ? heading : (webFetchUrl ?? displayText));
  const changedFiles = workEntry.changedFiles ?? [];
  const showEditedRows = isFileChangeWorkEntry(workEntry) && changedFiles.length > 0;
  const showSubagentRows =
    workEntry.itemType === "collab_agent_tool_call" && (workEntry.subagents?.length ?? 0) > 0;
  const visibleSubagents = workEntry.subagents?.slice(0, 3) ?? [];
  const hiddenSubagentCount = Math.max(
    0,
    (workEntry.subagents?.length ?? 0) - visibleSubagents.length,
  );
  const subagentSummary = subagentCardSummary(workEntry);
  const subagentMeta = subagentCardMeta(workEntry);
  const canOpenAgentActivity = Boolean(onOpenAgentActivity) && isAgentActivityWorkEntry(workEntry);
  const openAgentActivity = canOpenAgentActivity
    ? () => onOpenAgentActivity?.(workEntry.id)
    : undefined;
  const canOpenToolDetails = Boolean(onOpenToolDetails) && Boolean(workEntry.toolDetails);
  // File-read rows open the referenced file in the in-app viewer when the
  // hosting surface provides an opener (right-dock file pane / editor pane).
  const opener = useWorkspaceFileOpener();
  // Per-file +N/-M parsed from this tool call's own patch, used as a fallback when
  // the turn-diff summary isn't in scope (e.g. standalone work rows) so every
  // "Edited <file>" row can still show diff stats.
  const toolDiffStatsByPath = useMemo(
    () =>
      isFileChangeWorkEntry(workEntry)
        ? fileDiffStatsByPath(workEntry.toolDetails?.diff)
        : EMPTY_FILE_DIFF_STATS,
    [workEntry],
  );

  // A created-automation row renders as its own card instead of a tool-call line.
  // Kept after the hooks above so the early return never changes hook order.
  const automation = workEntry.automation;
  if (automation) {
    return (
      <div className={cn(compact ? "py-0.5" : "py-1")}>
        <AutomationCreatedCard
          name={automation.name}
          cadenceLabel={automation.cadenceLabel}
          textFontSizePx={textFontSizePx}
          metaFontSizePx={chatMetaFontSizePx}
          {...(onOpenAutomation ? { onOpen: () => onOpenAutomation(automation.id) } : {})}
        />
      </div>
    );
  }

  const readFilePath =
    opener !== null &&
    !canOpenAgentActivity &&
    workEntry.detail &&
    (workEntry.requestKind === "file-read" || isFileReadToolEntry(workEntry))
      ? extractFilePathFromDetail(workEntry.detail)
      : null;
  const canOpenReadFile = readFilePath !== null;
  const openReadFile = readFilePath
    ? () => openWorkspaceFileReference(opener, readFilePath)
    : undefined;
  const prefetchReadFile =
    readFilePath && opener?.prefetchFile ? () => opener.prefetchFile?.(readFilePath) : undefined;

  // Use the text font size (matching the UI settings) for tool call rows
  const rowFontSizePx = textFontSizePx;

  return (
    <div className={cn(compact ? "py-0.5" : "rounded-lg py-1")}>
      {showEditedRows ? (
        <div className="space-y-0.5">
          {changedFiles.map((changedFilePath) => {
            // Prefer the turn-diff summary's per-file stat; fall back to the stat
            // parsed from this tool call's own patch so the +N/-M shows even when
            // no summary is in scope (standalone work rows) or it lacks the file.
            const summaryStat = fileDiffStatByPath?.get(changedFilePath);
            const changedFileStat =
              summaryStat && summaryStat.additions + summaryStat.deletions > 0
                ? summaryStat
                : (resolveFileDiffStatByChangedPath(
                    toolDiffStatsByPath,
                    changedFilePath,
                    changedFiles.length,
                  ) ?? summaryStat);
            const canOpenEditedDiff = Boolean(turnId && onOpenTurnDiff);
            const canOpenEditedRow = canOpenToolDetails || canOpenEditedDiff;
            const editedRowClassName = cn(
              "group/file-row flex w-full max-w-full items-center text-left transition-colors duration-150",
              compact ? "gap-1.5" : "gap-2",
              canOpenEditedRow ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
            );
            const editedRowChildren = (
              <EditedFileRowContent
                filePath={changedFilePath}
                additions={changedFileStat?.additions}
                deletions={changedFileStat?.deletions}
                fontSizePx={rowFontSizePx}
                compact={compact}
              />
            );
            if (canOpenToolDetails && workEntry.toolDetails) {
              return (
                <ToolDetailsDisclosure
                  key={`${workEntry.id}:${changedFilePath}`}
                  details={workEntry.toolDetails}
                  compact={compact}
                  tooltip={<span className="whitespace-pre-wrap">{changedFilePath}</span>}
                  summaryClassName={editedRowClassName}
                  dataFileChangeRow
                >
                  {editedRowChildren}
                </ToolDetailsDisclosure>
              );
            }
            return (
              <button
                key={`${workEntry.id}:${changedFilePath}`}
                type="button"
                data-file-change-row="true"
                className={editedRowClassName}
                title={changedFilePath}
                disabled={!canOpenEditedRow}
                onClick={() => {
                  if (!turnId || !onOpenTurnDiff) {
                    return;
                  }
                  onOpenTurnDiff(turnId, changedFilePath);
                }}
              >
                {editedRowChildren}
              </button>
            );
          })}
        </div>
      ) : showSubagentRows ? (
        <div className="space-y-1.5">
          <AgentActivityOpenSurface
            canOpen={canOpenAgentActivity}
            compact={compact}
            title={hoverText}
            onOpen={openAgentActivity}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center text-muted-foreground/40",
                compact ? "size-4" : "size-5",
              )}
            >
              <EntryIcon className={compact ? "size-2.5" : "size-3"} />
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p
                className={cn(
                  compact ? "truncate leading-5" : "truncate leading-6",
                  "font-medium text-foreground/72",
                )}
                style={{ fontSize: `${rowFontSizePx}px` }}
                title={hoverText}
              >
                <span>{subagentSummary}</span>
              </p>
              {subagentMeta ? (
                <p
                  className="truncate leading-4 text-muted-foreground/32"
                  style={{ fontSize: `${Math.max(11, rowFontSizePx - 1)}px` }}
                  title={subagentMeta}
                >
                  {subagentMeta}
                </p>
              ) : null}
            </div>
          </AgentActivityOpenSurface>
          {visibleSubagents.length > 0 || hiddenSubagentCount > 0 ? (
            <div
              className={cn(
                "space-y-[5px] rounded-[14px] border border-border/45 bg-background/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
                compact ? "px-2.5 py-2" : "px-3 py-[9px]",
              )}
            >
              {visibleSubagents.map((subagent) => {
                const presentation = subagentPrimaryLabel(subagent);
                const primaryLabel = presentation.primaryLabel;
                const secondaryLabel = subagentSecondaryLabel(subagent, primaryLabel);
                const displayStatusLabel =
                  subagent.statusLabel ??
                  humanizeSubagentStatus(subagent.rawStatus, subagent.isActive);
                const canOpenThread = Boolean(onOpenThread);
                return (
                  <div
                    key={`${workEntry.id}:${subagent.threadId}`}
                    className="flex items-start gap-2.5 rounded-xl border border-border/28 bg-background/82 px-[11px] py-2"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        subagent.isActive ? "bg-sky-300/95" : "bg-muted-foreground/22",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate font-semibold leading-[18px] text-foreground/90"
                        style={{ fontSize: `${rowFontSizePx}px` }}
                        title={presentation.fullLabel}
                      >
                        <span style={{ color: presentation.accentColor }}>
                          {presentation.nickname ?? primaryLabel}
                        </span>
                        {presentation.role ? (
                          <span className="ml-1 text-[11px] font-medium text-muted-foreground/48">
                            ({presentation.role})
                          </span>
                        ) : null}
                      </div>
                      {secondaryLabel ? (
                        <div
                          className="truncate pt-0.5 leading-4 text-muted-foreground/56"
                          style={{ fontSize: `${Math.max(11, rowFontSizePx - 1)}px` }}
                          title={secondaryLabel}
                        >
                          {secondaryLabel}
                        </div>
                      ) : null}
                      {subagent.latestUpdate ? (
                        <div
                          className="flex items-baseline gap-1.5 pt-1 text-muted-foreground/42"
                          style={{ fontSize: `${Math.max(10, rowFontSizePx - 2)}px` }}
                          title={subagent.latestUpdate}
                        >
                          <span className="shrink-0 text-muted-foreground/30">Latest</span>
                          <span className="truncate">{subagent.latestUpdate}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {displayStatusLabel ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-[0.08em]",
                            subagentStatusClasses(
                              displayStatusLabel,
                              subagent.rawStatus,
                              subagent.isActive,
                            ),
                          )}
                        >
                          {displayStatusLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={cn(
                          "shrink-0 rounded-full border border-border/45 px-2.5 py-1 text-[9px] font-medium text-muted-foreground/62 transition-colors",
                          canOpenThread
                            ? "hover:border-foreground/15 hover:text-foreground/84"
                            : "cursor-default opacity-50",
                        )}
                        disabled={!canOpenThread}
                        onClick={() =>
                          onOpenThread?.(
                            ThreadId.makeUnsafe(subagent.resolvedThreadId ?? subagent.threadId),
                          )
                        }
                      >
                        Open thread
                      </button>
                    </div>
                  </div>
                );
              })}
              {hiddenSubagentCount > 0 ? (
                <div className="pl-4 text-[10px] text-muted-foreground/46">
                  +{hiddenSubagentCount} more
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        (() => {
          const rowContentChildren = (
            <>
              {!isCodexStatusRow ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center",
                    WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    compact ? "size-4" : "size-5",
                  )}
                  data-tool-icon={leftIconKind}
                  data-work-entry-icon="true"
                >
                  {webFetchUrl ? (
                    <LinkChipIcon url={webFetchUrl} className={compact ? "size-3.5" : "size-4"} />
                  ) : (
                    <LeftIcon className={compact ? "size-3.5" : "size-4"} />
                  )}
                </span>
              ) : null}
              <div
                className={cn(
                  "min-w-0 overflow-hidden",
                  // Single-line tool labels size to their content so the disclosure
                  // chevron can sit right after the name; the multi-line markdown
                  // preview still needs the full row width.
                  showInlineAgentTaskPreview && "flex-1",
                )}
              >
                {showInlineAgentTaskPreview ? (
                  <div className={cn(compact ? "space-y-[1px]" : "space-y-0.5")}>
                    <p
                      className="truncate font-medium leading-5 text-muted-foreground/72"
                      style={{ fontSize: `${rowFontSizePx}px` }}
                    >
                      {heading}
                    </p>
                    <ChatMarkdown
                      text={preview ?? ""}
                      cwd={markdownCwd}
                      isStreaming={false}
                      className="leading-relaxed"
                      style={{
                        color: "color-mix(in srgb, var(--muted-foreground) 72%, transparent)",
                        fontSize: `${Math.max(11, rowFontSizePx - 1)}px`,
                        lineHeight: compact ? "18px" : "19px",
                      }}
                      onImageExpand={onImageExpand}
                    />
                  </div>
                ) : (
                  <p
                    className={cn(
                      compact ? "truncate leading-5" : "truncate leading-6",
                      // Match the leading icon's tone so the row reads as one muted unit, and
                      // brighten the whole row to foreground on hover/focus instead of a fill.
                      WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    )}
                    data-codex-status-row={isCodexStatusRow ? "true" : undefined}
                    style={{ fontSize: `${rowFontSizePx}px` }}
                  >
                    <span data-work-entry-display-text="true">{displayText}</span>
                  </p>
                )}
              </div>
            </>
          );
          if (canOpenToolDetails && workEntry.toolDetails) {
            return (
              <ToolDetailsDisclosure
                details={workEntry.toolDetails}
                compact={compact}
                tooltip={toolRowTooltipContent(rawCommand, displayText, displayText)}
              >
                {rowContentChildren}
              </ToolDetailsDisclosure>
            );
          }

          const rowContent = (
            <AgentActivityOpenSurface
              canOpen={canOpenAgentActivity || canOpenReadFile}
              compact={compact}
              onOpen={openAgentActivity ?? openReadFile}
              onHover={prefetchReadFile}
              tooltip={toolRowTooltipContent(
                rawCommand,
                displayText,
                canOpenReadFile ? (readFilePath ?? hoverText) : hoverText,
              )}
            >
              {rowContentChildren}
            </AgentActivityOpenSurface>
          );

          return rowContent;
        })()
      )}
    </div>
  );
});

// Inner content for an "Edited <file> +n/-m" row. Mirrors the tool-call row treatment
// (muted leading icon + label that brightens to foreground on hover/focus, same font
// size) so edited rows read as the same visual unit. Callers own the interactive wrapper
// (`group/file-row` button or disclosure summary) and pass the diff stat when available.
