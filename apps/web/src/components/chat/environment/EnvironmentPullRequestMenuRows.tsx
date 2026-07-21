// FILE: EnvironmentPullRequestMenuRows.tsx
// Purpose: Renders pull-request check and review-comment popup rows.
// Layer: Environment panel UI

import type { GitPullRequestCheck, GitPullRequestComment } from "@agent-group/contracts";
import type { ReactNode } from "react";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { MenuItem } from "../../ui/menu";
import { PullRequestCheckStatusIcon } from "../../pullRequest/PullRequestCheckStatusIcon";
import { PR_QUIET_INK_CLASS_NAME } from "../../pullRequest/pullRequestText";
import {
  describePullRequestComment,
  PULL_REQUEST_CHECK_STATUS_LABELS,
} from "./environmentPullRequest.logic";

function MenuRow({
  url,
  onOpenUrl,
  className,
  children,
}: {
  url: string | null;
  onOpenUrl: (url: string) => void;
  className: string;
  children: ReactNode;
}) {
  if (!url) {
    return (
      <div className={cn("w-full cursor-default rounded-[0.5rem] text-left", className)}>
        {children}
      </div>
    );
  }
  return (
    <MenuItem
      onClick={() => onOpenUrl(url)}
      className={cn(
        "w-full cursor-pointer rounded-[0.5rem] text-left data-highlighted:bg-[var(--color-background-elevated-secondary)]",
        className,
      )}
    >
      {children}
    </MenuItem>
  );
}

export function ChecksMenuRow({
  check,
  onOpenUrl,
}: {
  check: GitPullRequestCheck;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <MenuRow
      url={check.url}
      onOpenUrl={onOpenUrl}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1 text-[length:var(--app-font-size-ui,12px)]"
    >
      <PullRequestCheckStatusIcon status={check.status} />
      <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{check.name}</span>
      <span className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
        {PULL_REQUEST_CHECK_STATUS_LABELS[check.status]}
      </span>
    </MenuRow>
  );
}

export function CommentsMenuRow({
  comment,
  onOpenUrl,
}: {
  comment: GitPullRequestComment;
  onOpenUrl: (url: string) => void;
}) {
  const display = describePullRequestComment(comment);
  return (
    <MenuRow
      url={comment.url}
      onOpenUrl={onOpenUrl}
      className="flex flex-col items-stretch gap-0.5 px-2 py-1.5"
    >
      <span className="line-clamp-2 text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)]">
        {display.title}
      </span>
      {display.snippet ? (
        <span className="line-clamp-2 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
          {display.snippet}
        </span>
      ) : null}
      <span
        className={cn(
          PR_QUIET_INK_CLASS_NAME,
          "flex items-center justify-between gap-2 text-[length:var(--app-font-size-ui-xs,10px)]",
        )}
      >
        <span className="min-w-0 truncate">{comment.path ?? comment.author ?? ""}</span>
        {comment.createdAt ? (
          <span className="shrink-0 tabular-nums">{formatRelativeTime(comment.createdAt)}</span>
        ) : null}
      </span>
    </MenuRow>
  );
}

export function MenuPlaceholder({ text }: { text: string }) {
  return (
    <div className="px-3 py-3 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground">
      {text}
    </div>
  );
}
