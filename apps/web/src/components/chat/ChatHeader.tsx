// FILE: ChatHeader.tsx
// Purpose: Renders the chat top bar with project actions and panel toggles.
// Layer: Chat shell header
// Depends on: project action controls, git actions, and panel toggle callbacks

import { memo } from "react";
import { useOpenFavoriteEditorShortcut } from "~/hooks/useOpenFavoriteEditorShortcut";
import { cn } from "~/lib/utils";
import GitActionsControl from "../GitActionsControl";
import { ProviderUsageMenuControl } from "../ProviderUsageMenuControl";
import ProjectScriptsControl from "../ProjectScriptsControl";
import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { useSidebar } from "../ui/sidebar";
import { EnvironmentToggle } from "./environment/EnvironmentToggle";
import { OpenInPicker } from "./OpenInPicker";
import { ChatHeaderDiffToggle } from "./header/ChatHeaderDiffToggle";
import { ChatHeaderEditorRail } from "./header/ChatHeaderEditorRail";
import { ChatHeaderHandoffBadge, ChatHeaderHandoffMenu } from "./header/ChatHeaderHandoffControls";
import { ChatHeaderIdentity } from "./header/ChatHeaderIdentity";
import { ChatHeaderLayoutControls } from "./header/ChatHeaderLayoutControls";
import type { ChatHeaderProps } from "./header/chatHeaderTypes";
import { useChatHeaderCompact } from "./header/useChatHeaderCompact";

export {
  resolveChatHeaderThreadIconKind,
  type ChatHeaderThreadIconKind,
} from "./header/ChatHeaderIdentity";

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  agentGroupId,
  activeThreadTitle,
  activeThreadEntryPoint,
  activeProvider,
  activeProjectName,
  threadBreadcrumbs,
  className,
  hideSidebarControls = false,
  hideHandoffControls = false,
  isGitRepo,
  openInTarget,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  handoffBadgeLabel,
  handoffActionLabel,
  handoffDisabled,
  handoffActionTargetProviders,
  handoffBadgeSourceProvider,
  handoffBadgeTargetProvider,
  gitCwd,
  diffTotals,
  showGitActions = true,
  showDiffToggle = true,
  diffOpen,
  diffDisabledReason = null,
  surfaceMode = "single",
  isSidechat = false,
  sidechatPromotionBusy = false,
  sidechatPromotionDisabled = false,
  environment = null,
  chatLayoutAction = null,
  changeThreadAction = null,
  editorChatControls = null,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
  onCreateHandoff,
  onNavigateToThread,
  onRenameThread,
  onCloseThreadPane,
  onPromoteSidechat,
}: ChatHeaderProps) {
  const { isMobile, state } = useSidebar();
  const { headerRef, compact } = useChatHeaderCompact(surfaceMode === "split");
  const showSidechatTitleChip = isSidechat && compact;

  useOpenFavoriteEditorShortcut({
    keybindings,
    availableEditors,
    openInTarget,
    enabled: Boolean(activeProjectName),
  });

  const editorRail = editorChatControls ? (
    <ChatHeaderEditorRail
      controls={editorChatControls}
      activeThreadId={activeThreadId}
      activeThreadTitle={activeThreadTitle}
      activeProvider={activeProvider}
      onNavigateToThread={onNavigateToThread}
    />
  ) : null;
  const handoffBadge =
    !hideHandoffControls && handoffBadgeLabel ? (
      <ChatHeaderHandoffBadge
        label={handoffBadgeLabel}
        sourceProvider={handoffBadgeSourceProvider}
        targetProvider={handoffBadgeTargetProvider}
      />
    ) : null;
  const diffToggleControl = (
    <ChatHeaderDiffToggle
      visible={showDiffToggle}
      isGitRepo={isGitRepo}
      open={diffOpen}
      disabledReason={diffDisabledReason}
      shortcutLabel={diffToggleShortcutLabel}
      totals={diffTotals}
      onToggle={onToggleDiff}
    />
  );

  return (
    <div ref={headerRef} className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          editorChatControls ? "h-full overflow-visible" : "overflow-hidden",
          !isMobile && state === "collapsed" ? "gap-4" : "gap-2 sm:gap-3",
        )}
      >
        {hideSidebarControls ? null : <SidebarHeaderNavigationControls />}
        <div
          className={cn("flex min-w-0 flex-1 items-center gap-2", editorChatControls && "h-full")}
        >
          <ChatHeaderIdentity
            activeThreadId={activeThreadId}
            agentGroupId={agentGroupId}
            activeThreadTitle={activeThreadTitle}
            activeThreadEntryPoint={activeThreadEntryPoint}
            activeProvider={activeProvider}
            threadBreadcrumbs={threadBreadcrumbs}
            showSidechatTitleChip={showSidechatTitleChip}
            sidechatPromotionBusy={sidechatPromotionBusy}
            sidechatPromotionDisabled={sidechatPromotionDisabled}
            onNavigateToThread={onNavigateToThread}
            onRenameThread={onRenameThread}
            {...(onCloseThreadPane ? { onCloseThreadPane } : {})}
            {...(onPromoteSidechat ? { onPromoteSidechat } : {})}
            editorRail={editorRail}
            handoffBadge={handoffBadge}
            editorRailActive={editorChatControls !== null}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
        {!hideHandoffControls && !environment ? (
          <ProviderUsageMenuControl provider={activeProvider} />
        ) : null}
        {!hideHandoffControls ? (
          <ChatHeaderHandoffMenu
            compact={compact}
            actionLabel={handoffActionLabel}
            disabled={handoffDisabled}
            targetProviders={handoffActionTargetProviders}
            onCreateHandoff={onCreateHandoff}
          />
        ) : null}
        {activeProjectScripts ? (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            hideInlineLabel={compact}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        ) : null}
        <ChatHeaderLayoutControls
          layoutAction={chatLayoutAction}
          changeThreadAction={changeThreadAction}
        />
        {environment ? (
          <>
            <EnvironmentToggle environment={environment} />
            {diffToggleControl}
          </>
        ) : (
          <>
            {activeProjectName ? (
              <OpenInPicker
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInTarget={openInTarget}
              />
            ) : null}
            {activeProjectName && showGitActions ? (
              <GitActionsControl
                gitCwd={gitCwd}
                activeThreadId={activeThreadId}
                hideQuickActionLabel={compact}
              />
            ) : null}
            {diffToggleControl}
          </>
        )}
      </div>
    </div>
  );
});
