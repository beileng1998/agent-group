import type { ReactNode } from "react";

import { Button } from "../ui/button";
import {
  ChatHeaderSplitDivider,
  ChatHeaderSplitGroup,
  CHAT_HEADER_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
  CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
  CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
} from "../chat/chatHeaderControls";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRow,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "../chat/environment/EnvironmentRow";
import type { GitQuickAction } from "../GitActionsControl.logic";
import { Menu, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ChevronDownIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { GitActionGlyph, GitQuickActionIcon } from "./GitActionPresentation";

interface GitInitSurfaceProps {
  isRepo: boolean;
  isInitPending: boolean;
  onInitialize: () => void;
  onMenuOpen: () => void;
  menuContent: ReactNode;
}

export interface GitActionPanelSurfaceProps extends GitInitSurfaceProps {
  shouldDimCommitPushRow: boolean;
}

export function GitActionPanelSurface({
  isRepo,
  isInitPending,
  onInitialize,
  onMenuOpen,
  menuContent,
  shouldDimCommitPushRow,
}: GitActionPanelSurfaceProps) {
  if (!isRepo) {
    return (
      <EnvironmentRow
        icon={<GitActionGlyph name="branch" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
        label={isInitPending ? "Initializing..." : "Initialize Git"}
        disabled={isInitPending}
        onClick={onInitialize}
      />
    );
  }

  return (
    <Menu
      onOpenChange={(open) => {
        if (open) onMenuOpen();
      }}
    >
      <MenuTrigger
        render={
          <button
            type="button"
            className={cn(ENVIRONMENT_ROW_CLASS_NAME, shouldDimCommitPushRow && "opacity-55")}
            aria-label={
              shouldDimCommitPushRow
                ? "Commit and Push unavailable; open Git actions menu"
                : "Commit and Push"
            }
            title={
              shouldDimCommitPushRow
                ? "Commit and Push unavailable. Open for more Git actions."
                : "Commit and Push"
            }
          />
        }
      >
        <EnvironmentRowBody
          icon={<GitActionGlyph name="push" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
          label="Commit and Push"
          trailing={<EnvironmentRowChevron />}
        />
      </MenuTrigger>
      {menuContent}
    </Menu>
  );
}

export interface GitActionHeaderSurfaceProps extends GitInitSurfaceProps {
  quickAction: GitQuickAction;
  quickActionDisabledReason: string | null;
  hideQuickActionLabel: boolean;
  isGitActionRunning: boolean;
  onRunQuickAction: () => void;
}

export function GitActionHeaderSurface({
  isRepo,
  isInitPending,
  onInitialize,
  onMenuOpen,
  menuContent,
  quickAction,
  quickActionDisabledReason,
  hideQuickActionLabel,
  isGitActionRunning,
  onRunQuickAction,
}: GitActionHeaderSurfaceProps) {
  if (!isRepo) {
    return (
      <Button
        variant="chrome-outline"
        size="xs"
        className={cn(CHAT_HEADER_CONTROL_CLASS_NAME, CHAT_HEADER_ICON_STRENGTH_CLASS_NAME)}
        disabled={isInitPending}
        onClick={onInitialize}
      >
        {isInitPending ? "Initializing..." : "Initialize Git"}
      </Button>
    );
  }

  return (
    <ChatHeaderSplitGroup label="Git actions">
      {quickActionDisabledReason ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            render={
              <Button
                aria-label={quickAction.label}
                aria-disabled="true"
                className={cn(
                  hideQuickActionLabel
                    ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                    : CHAT_HEADER_CONTROL_CLASS_NAME,
                  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                  CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
                  "cursor-not-allowed opacity-64",
                )}
                size={hideQuickActionLabel ? "icon-xs" : "xs"}
                variant="chrome-outline"
                title={quickAction.label}
              />
            }
          >
            <GitQuickActionIcon quickAction={quickAction} />
            {!hideQuickActionLabel ? (
              <span className="font-normal">{quickAction.label}</span>
            ) : null}
          </PopoverTrigger>
          <PopoverPopup tooltipStyle side="bottom" align="start">
            {quickActionDisabledReason}
          </PopoverPopup>
        </Popover>
      ) : (
        <Button
          variant="chrome-outline"
          size={hideQuickActionLabel ? "icon-xs" : "xs"}
          className={cn(
            hideQuickActionLabel
              ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
              : CHAT_HEADER_CONTROL_CLASS_NAME,
            CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
            CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
          )}
          disabled={isGitActionRunning || quickAction.disabled}
          aria-label={quickAction.label}
          title={quickAction.label}
          onClick={onRunQuickAction}
        >
          <GitQuickActionIcon quickAction={quickAction} />
          {!hideQuickActionLabel ? <span className="font-normal">{quickAction.label}</span> : null}
        </Button>
      )}
      <ChatHeaderSplitDivider />
      <Menu
        onOpenChange={(open) => {
          if (open) onMenuOpen();
        }}
      >
        <MenuTrigger
          render={
            <Button
              aria-label="Git action options"
              size="icon-xs"
              variant="chrome-outline"
              className={cn(
                CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
                CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
              )}
            />
          }
          disabled={isGitActionRunning}
        >
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </MenuTrigger>
        {menuContent}
      </Menu>
    </ChatHeaderSplitGroup>
  );
}
