import type { PullRequestMergeMethod } from "@agent-group/contracts";

import {
  CHAT_HEADER_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
  CHAT_SURFACE_CHIP_CLASS_NAME,
  CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
} from "~/components/chat/chatHeaderControls";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  EllipsisIcon,
  ExternalLinkIcon,
  GitMergeConflictIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  HammerIcon,
  LinkIcon,
  LoaderIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import type {
  PullRequestDetailController,
  PullRequestDetailTab,
} from "./usePullRequestDetailController";

const TABS: ReadonlyArray<{ value: PullRequestDetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

const PR_HEADER_ICON_BUTTON_CLASS_NAME = cn(
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
);

const PR_HEADER_ACTION_BUTTON_CLASS_NAME = cn(
  CHAT_HEADER_CONTROL_CLASS_NAME,
  "px-3 text-[length:var(--app-font-size-ui,12px)] font-normal sm:text-[length:var(--app-font-size-ui,12px)]",
);

export function PullRequestDetailHeader({
  controller,
  onClose,
}: {
  controller: PullRequestDetailController;
  onClose?: (() => void) | undefined;
}) {
  const {
    detail,
    tab,
    setTab,
    actionPending,
    pendingAction,
    preparingThread,
    allowedMethods,
    selectedMergeMethod,
    setMergeMethod,
    setConfirmAction,
    runAction,
    fixFindings,
    resolveConflicts,
    copyPullRequestLink,
  } = controller;

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 px-2">
      <nav className="flex min-w-0 items-center gap-0.5" aria-label="Pull request detail tabs">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => setTab(item.value)}
            className={cn(
              CHAT_SURFACE_CHIP_CLASS_NAME,
              "inline-flex items-center px-2.5",
              tab === item.value && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {detail ? (
          <>
            <IconButton
              variant="chrome"
              label="Open in external browser"
              tooltip="Open in external browser"
              className={PR_HEADER_ICON_BUTTON_CLASS_NAME}
              onClick={() => void ensureNativeApi().shell.openExternal(detail.url)}
            >
              <ExternalLinkIcon />
            </IconButton>
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    variant="chrome"
                    label="More actions"
                    title="More actions"
                    className={PR_HEADER_ICON_BUTTON_CLASS_NAME}
                  >
                    <EllipsisIcon />
                  </IconButton>
                }
              />
              <ComposerPickerMenuPopup align="end" side="bottom" className="w-56 min-w-56">
                {detail.state === "open" ? (
                  <>
                    <MenuRadioGroup
                      value={detail.isDraft ? "draft" : "ready"}
                      onValueChange={(value) => {
                        if (actionPending) return;
                        if (value === "draft" && !detail.isDraft) void runAction("draft");
                        if (value === "ready" && detail.isDraft) void runAction("ready");
                      }}
                    >
                      <MenuRadioItem value="draft" disabled={actionPending}>
                        <GitPullRequestDraftIcon className="size-3.5 shrink-0" />
                        <span>Draft</span>
                      </MenuRadioItem>
                      <MenuRadioItem value="ready" disabled={actionPending}>
                        <GitPullRequestIcon className="size-3.5 shrink-0" />
                        <span>Ready for review</span>
                      </MenuRadioItem>
                    </MenuRadioGroup>
                    <MenuSeparator />
                  </>
                ) : null}
                {detail.state === "open" &&
                !detail.isDraft &&
                detail.mergeability !== "conflicting" &&
                allowedMethods.length > 0 ? (
                  <>
                    <MenuRadioGroup
                      value={selectedMergeMethod}
                      onValueChange={(value) => setMergeMethod(value as PullRequestMergeMethod)}
                    >
                      {allowedMethods.map((method) => (
                        <MenuRadioItem key={method} value={method} disabled={actionPending}>
                          <GitMergeIcon className="size-3.5 shrink-0" />
                          <span className="capitalize">{method}</span>
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                    <MenuSeparator />
                  </>
                ) : null}
                <MenuItem onClick={() => void copyPullRequestLink()}>
                  <LinkIcon className="size-3.5 shrink-0" />
                  <span>Copy link</span>
                </MenuItem>
                <MenuItem onClick={fixFindings} disabled={preparingThread !== null}>
                  <HammerIcon className="size-3.5 shrink-0" />
                  <span>
                    {preparingThread === "findings" ? "Preparing findings…" : "Fix findings"}
                  </span>
                </MenuItem>
                {detail.state === "open" && detail.mergeability === "conflicting" ? (
                  <MenuItem onClick={resolveConflicts} disabled={preparingThread !== null}>
                    <GitMergeConflictIcon className="size-3.5 shrink-0" />
                    <span>
                      {preparingThread === "conflicts"
                        ? "Preparing conflicts…"
                        : "Resolve conflicts"}
                    </span>
                  </MenuItem>
                ) : null}
                {detail.state !== "merged" ? <MenuSeparator /> : null}
                {detail.state === "open" ? (
                  <MenuItem
                    variant="destructive"
                    disabled={actionPending}
                    onClick={() => setConfirmAction("close")}
                  >
                    <GitPullRequestClosedIcon className="size-3.5 shrink-0" />
                    <span>Close pull request</span>
                  </MenuItem>
                ) : detail.state === "closed" ? (
                  <MenuItem disabled={actionPending} onClick={() => void runAction("reopen")}>
                    <GitPullRequestIcon className="size-3.5 shrink-0" />
                    <span>Reopen pull request</span>
                  </MenuItem>
                ) : null}
              </ComposerPickerMenuPopup>
            </Menu>
            {detail.state === "open" && detail.isDraft ? (
              <Button
                size="xs"
                className={PR_HEADER_ACTION_BUTTON_CLASS_NAME}
                disabled={actionPending}
                onClick={() => void runAction("ready")}
              >
                Ready for review
              </Button>
            ) : detail.state === "open" && detail.mergeability === "conflicting" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="xs"
                      aria-disabled="true"
                      className={cn(
                        PR_HEADER_ACTION_BUTTON_CLASS_NAME,
                        "cursor-not-allowed opacity-64",
                      )}
                    />
                  }
                >
                  Merge
                </TooltipTrigger>
                <TooltipPopup side="bottom">Resolve merge conflicts before merging</TooltipPopup>
              </Tooltip>
            ) : detail.state === "open" && !detail.isDraft && allowedMethods.length > 0 ? (
              <Button
                size="xs"
                className={PR_HEADER_ACTION_BUTTON_CLASS_NAME}
                disabled={actionPending}
                onClick={() => setConfirmAction("merge")}
              >
                {pendingAction === "merge" ? (
                  <>
                    <LoaderIcon className="size-3.5 animate-spin" />
                    Merging…
                  </>
                ) : (
                  "Merge"
                )}
              </Button>
            ) : null}
          </>
        ) : null}
        {onClose ? (
          <IconButton
            variant="chrome"
            label="Close pull request panel"
            tooltip="Close"
            className={PR_HEADER_ICON_BUTTON_CLASS_NAME}
            onClick={onClose}
          >
            <XIcon />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
