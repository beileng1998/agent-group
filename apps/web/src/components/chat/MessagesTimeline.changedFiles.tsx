// FILE: MessagesTimeline.changedFiles.tsx
// Purpose: Render the settled turn's changed-files summary and actions.
// Layer: Web chat timeline presentation

import type { TurnId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import type { CSSProperties } from "react";
import { ChangesIcon, Undo2Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { TurnDiffSummary } from "../../types";
import { DiffStatLabel } from "./DiffStatLabel";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { FileEntryIcon } from "./FileEntryIcon";
import { ReviewChangesButton } from "./ReviewChangesButton";

const MAX_VISIBLE_CHANGED_FILES = 5;

export function SettledTurnChangedFiles(props: {
  assistantTurnInProgress: boolean;
  chatTypographyStyle: CSSProperties;
  expandedFileChangesByTurnId: Record<string, boolean>;
  expandedFileListByTurnId: Record<string, boolean>;
  isTailContentRow: boolean;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onUndoTurnFiles?: ((turnCounts: readonly number[]) => void) | undefined;
  resolvedTheme: "light" | "dark";
  scrollTailExpansionToEnd: () => void;
  toggleFileChangesExpanded: (turnId: TurnId) => void;
  toggleFileListExpanded: (turnId: TurnId) => void;
  turnSummary: TurnDiffSummary | undefined;
}) {
  const {
    assistantTurnInProgress,
    chatTypographyStyle,
    expandedFileChangesByTurnId,
    expandedFileListByTurnId,
    isTailContentRow,
    onOpenTurnDiff,
    onUndoTurnFiles,
    resolvedTheme,
    scrollTailExpansionToEnd,
    toggleFileChangesExpanded,
    toggleFileListExpanded,
    turnSummary,
  } = props;
  if (!turnSummary || assistantTurnInProgress) return null;
  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) return null;
  const fileChangesExpanded = expandedFileChangesByTurnId[turnSummary.turnId] ?? true;
  const fileListExpanded = expandedFileListByTurnId[turnSummary.turnId] ?? false;
  const checkpointTurnCount = turnSummary.checkpointTurnCount;
  const checkpointTurnCounts =
    turnSummary.checkpointTurnCounts ??
    (checkpointTurnCount === undefined ? [] : [checkpointTurnCount]);
  const canUndo =
    turnSummary.status !== "missing" &&
    turnSummary.status !== "error" &&
    turnSummary.checkpointRef !== undefined &&
    !turnSummary.checkpointRef.startsWith("provider-diff:") &&
    checkpointTurnCounts.length > 0 &&
    onUndoTurnFiles !== undefined;
  const totalAdditions = checkpointFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDeletions = checkpointFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const editedFilesLabel = `Edited ${checkpointFiles.length} ${pluralize(
    checkpointFiles.length,
    "file",
  )}`;
  const firstCheckpointFiles = checkpointFiles.slice(0, MAX_VISIBLE_CHANGED_FILES);
  const overflowCheckpointFiles = checkpointFiles.slice(MAX_VISIBLE_CHANGED_FILES);
  const renderCheckpointFileRow = (
    file: (typeof checkpointFiles)[number],
    withFirstReset: boolean,
  ) => (
    <button
      key={file.path}
      type="button"
      className={cn(
        "group/file-row flex w-full items-center gap-2 border-t border-[color:var(--color-border-light)] bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] dark:bg-transparent dark:hover:bg-transparent",
        withFirstReset && "first:border-t-0",
      )}
      onClick={() => onOpenTurnDiff(turnSummary.turnId, file.path)}
    >
      <FileEntryIcon
        pathValue={file.path}
        kind="file"
        theme={resolvedTheme}
        colorMode="inherit"
        className="size-4 shrink-0 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80"
      />
      <span
        className="font-system-ui truncate font-normal text-[var(--color-text-foreground)] underline-offset-2 group-hover/file-row:underline group-focus-visible/file-row:underline"
        style={{ fontSize: chatTypographyStyle.fontSize }}
      >
        {file.path}
      </span>
      {(file.additions ?? 0) + (file.deletions ?? 0) > 0 && (
        <span
          className="font-system-ui ml-auto shrink-0 tabular-nums"
          style={{ fontSize: chatTypographyStyle.fontSize }}
        >
          <DiffStatLabel additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
        </span>
      )}
    </button>
  );
  return (
    <div className="mt-1 mb-4 overflow-hidden rounded-[0.65rem] border border-[color:var(--color-border-light)] dark:border-[color:color-mix(in_srgb,var(--color-border-light)_55%,transparent)]">
      <div
        className={cn(
          "flex items-center justify-between gap-3 bg-[color:color-mix(in_srgb,var(--app-user-message-background)_40%,transparent)] px-3 py-1.5",
          fileChangesExpanded && "border-b border-[color:var(--color-border-light)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <ChangesIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <div className="min-w-0">
            <div
              className="truncate font-normal text-foreground/92"
              style={{ fontSize: chatTypographyStyle.fontSize }}
            >
              {editedFilesLabel}
            </div>
            {totalAdditions + totalDeletions > 0 ? (
              <div
                className="font-system-ui tabular-nums"
                style={{ fontSize: chatTypographyStyle.fontSize }}
              >
                <DiffStatLabel additions={totalAdditions} deletions={totalDeletions} />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canUndo && (
            <button
              type="button"
              className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              style={{ fontSize: chatTypographyStyle.fontSize }}
              onClick={() => onUndoTurnFiles(checkpointTurnCounts)}
            >
              Undo
              <Undo2Icon className="size-3" />
            </button>
          )}
          <ReviewChangesButton
            style={{ fontSize: chatTypographyStyle.fontSize }}
            onClick={() => onOpenTurnDiff(turnSummary.turnId)}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground/80"
            aria-expanded={fileChangesExpanded}
            aria-label={
              fileChangesExpanded ? "Collapse changed files list" : "Expand changed files list"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!fileChangesExpanded && isTailContentRow) {
                scrollTailExpansionToEnd();
              }
              toggleFileChangesExpanded(turnSummary.turnId);
            }}
            data-scroll-anchor-ignore={isTailContentRow ? true : undefined}
          >
            <DisclosureChevron
              open={fileChangesExpanded}
              className="dark:text-muted-foreground/50"
            />
          </button>
        </div>
      </div>
      <DisclosureRegion open={fileChangesExpanded}>
        {firstCheckpointFiles.map((file) => renderCheckpointFileRow(file, true))}
        {overflowCheckpointFiles.length > 0 ? (
          <DisclosureRegion open={fileListExpanded}>
            {overflowCheckpointFiles.map((file) => renderCheckpointFileRow(file, false))}
          </DisclosureRegion>
        ) : null}
        {overflowCheckpointFiles.length > 0 ? (
          <button
            type="button"
            className="flex w-full items-center justify-start gap-1.5 border-t border-[color:var(--color-border-light)] bg-transparent px-3 py-2 font-system-ui font-normal text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
            style={{ fontSize: chatTypographyStyle.fontSize }}
            aria-expanded={fileListExpanded}
            onClick={() => toggleFileListExpanded(turnSummary.turnId)}
          >
            <DisclosureChevron open={fileListExpanded} />
            <span>
              {fileListExpanded
                ? "Show less"
                : `Show ${overflowCheckpointFiles.length} more ${pluralize(
                    overflowCheckpointFiles.length,
                    "file",
                  )}`}
            </span>
          </button>
        ) : null}
      </DisclosureRegion>
    </div>
  );
}
