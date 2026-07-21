import {
  PROVIDER_DISPLAY_NAMES,
  type ProjectId,
  type ProviderKind,
  type ThreadId,
} from "@agent-group/contracts";
import { isGenericChatThreadTitle } from "@agent-group/shared/chatThreads";
import type { ReactNode } from "react";
import React from "react";
import { FiGitBranch } from "react-icons/fi";
import { GitBranchIcon, Loader2Icon, TerminalIcon, XIcon } from "~/lib/icons";
import type { ThreadPrimarySurface } from "../../../types";
import { AgentGroupAwarenessHeaderControl } from "../../AgentGroupAwarenessHeaderControl";
import { ProviderIcon } from "../../ProviderIcon";
import { IconButton } from "../../ui/icon-button";
import { cn } from "~/lib/utils";

export type ChatHeaderThreadIconKind = "none" | "provider" | "terminal";

export function resolveChatHeaderThreadIconKind(
  entryPoint: ThreadPrimarySurface,
  title?: string,
): ChatHeaderThreadIconKind {
  if (entryPoint === "chat" && isGenericChatThreadTitle(title)) {
    return "none";
  }
  return entryPoint === "terminal" ? "terminal" : "provider";
}

export function HeaderProviderIcon(props: { provider: ProviderKind | null; className: string }) {
  return (
    <ProviderIcon
      provider={props.provider}
      tone="header"
      className={props.className}
      fallback={<FiGitBranch className={props.className} />}
    />
  );
}

export function ChatHeaderIdentity(props: {
  activeThreadId: ThreadId;
  agentGroupId: ProjectId | null;
  activeThreadTitle: string;
  activeThreadEntryPoint: ThreadPrimarySurface;
  activeProvider: ProviderKind;
  threadBreadcrumbs: ReadonlyArray<{ threadId: ThreadId; title: string }>;
  showSidechatTitleChip: boolean;
  sidechatPromotionBusy: boolean;
  sidechatPromotionDisabled: boolean;
  onNavigateToThread: (threadId: ThreadId) => void;
  onRenameThread: () => void;
  onCloseThreadPane?: () => void;
  onPromoteSidechat?: () => void;
  editorRail: ReactNode;
  handoffBadge: ReactNode;
  editorRailActive: boolean;
}) {
  const threadIconKind = resolveChatHeaderThreadIconKind(
    props.activeThreadEntryPoint,
    props.activeThreadTitle,
  );

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col",
        props.editorRailActive && "h-full justify-center",
      )}
    >
      {props.threadBreadcrumbs.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/55">
          {props.threadBreadcrumbs.map((breadcrumb, index) => (
            <React.Fragment key={breadcrumb.threadId}>
              {index > 0 ? <span className="shrink-0 text-muted-foreground/35">/</span> : null}
              <button
                type="button"
                className="min-w-0 truncate transition-colors hover:text-foreground/80"
                title={breadcrumb.title}
                onClick={() => props.onNavigateToThread(breadcrumb.threadId)}
              >
                {breadcrumb.title}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <div className={cn("flex min-w-0 items-center gap-2", props.editorRailActive && "h-full")}>
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            props.showSidechatTitleChip &&
              "rounded-lg bg-secondary py-1 pl-2 pr-1 text-secondary-foreground",
          )}
        >
          {props.agentGroupId ? (
            <AgentGroupAwarenessHeaderControl
              groupId={props.agentGroupId}
              sessionId={props.activeThreadId}
              sessionTitle={props.activeThreadTitle}
            />
          ) : null}
          {threadIconKind === "none" ? null : (
            <span
              className="inline-flex size-3.5 shrink-0 items-center justify-center"
              title={
                threadIconKind === "terminal"
                  ? "Terminal"
                  : PROVIDER_DISPLAY_NAMES[props.activeProvider]
              }
            >
              {threadIconKind === "terminal" ? (
                <TerminalIcon className="size-3.5 text-[var(--color-text-accent)]" />
              ) : (
                <HeaderProviderIcon provider={props.activeProvider} className="size-3.5" />
              )}
            </span>
          )}
          <h2
            className="max-w-[clamp(12rem,42vw,36rem)] truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-foreground"
            title={props.activeThreadTitle}
            onDoubleClick={props.onRenameThread}
          >
            {props.activeThreadTitle}
          </h2>
          {props.showSidechatTitleChip && props.onPromoteSidechat ? (
            <IconButton
              variant="chrome"
              size="icon-xs"
              label="Keep as child session"
              tooltip={
                props.sidechatPromotionDisabled && !props.sidechatPromotionBusy
                  ? "Wait for Side to finish before keeping it"
                  : "Keep as child session"
              }
              tooltipSide="bottom"
              disabled={props.sidechatPromotionDisabled}
              className="size-5 rounded-lg [-webkit-app-region:no-drag] [&_svg]:size-3"
              onClick={(event) => {
                event.stopPropagation();
                props.onPromoteSidechat?.();
              }}
            >
              {props.sidechatPromotionBusy ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <GitBranchIcon />
              )}
            </IconButton>
          ) : null}
          {props.showSidechatTitleChip && props.onCloseThreadPane ? (
            <IconButton
              variant="chrome"
              size="icon-xs"
              label="Discard Side"
              tooltip="Discard temporary Side"
              tooltipSide="bottom"
              className="size-5 rounded-lg [-webkit-app-region:no-drag] [&_svg]:size-3"
              onClick={(event) => {
                event.stopPropagation();
                props.onCloseThreadPane?.();
              }}
            >
              <XIcon />
            </IconButton>
          ) : null}
        </div>
        {props.editorRail}
        {props.handoffBadge}
      </div>
    </div>
  );
}
