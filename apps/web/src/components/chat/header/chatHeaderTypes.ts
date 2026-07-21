import type {
  EditorId,
  ProjectId,
  ProjectScript,
  ProviderKind,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@agent-group/contracts";
import type { RepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import type { ThreadPrimarySurface } from "../../../types";
import type { NewProjectScriptInput } from "../../ProjectScriptsControl";
import type { EnvironmentToggleState } from "../environment/EnvironmentToggle";

export interface EditorChatControls {
  projectId: ProjectId;
  activeSurface: "chat" | "terminal";
  terminalAvailable: boolean;
  terminalHasRunningActivity: boolean;
  onNewChat: () => void;
  onNewTerminal: () => void;
  onOpenChat: (threadId: ThreadId) => void;
  onOpenTerminal: () => void;
  onCloseTerminal: () => void;
}

export interface ChatHeaderProps {
  activeThreadId: ThreadId;
  agentGroupId: ProjectId | null;
  activeThreadTitle: string;
  activeThreadEntryPoint: ThreadPrimarySurface;
  activeProvider: ProviderKind;
  activeProjectName: string | undefined;
  threadBreadcrumbs: ReadonlyArray<{
    threadId: ThreadId;
    title: string;
  }>;
  className?: string;
  hideSidebarControls?: boolean;
  hideHandoffControls?: boolean;
  isGitRepo: boolean;
  openInTarget: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  handoffBadgeLabel: string | null;
  handoffActionLabel: string;
  handoffDisabled: boolean;
  handoffActionTargetProviders: ReadonlyArray<ProviderKind>;
  handoffBadgeSourceProvider: ProviderKind | null;
  handoffBadgeTargetProvider: ProviderKind | null;
  gitCwd: string | null;
  diffTotals: RepoDiffTotals;
  showGitActions?: boolean;
  showDiffToggle?: boolean;
  diffOpen: boolean;
  diffDisabledReason?: string | null;
  surfaceMode?: "single" | "split";
  isSidechat?: boolean;
  sidechatPromotionBusy?: boolean;
  sidechatPromotionDisabled?: boolean;
  environment?: EnvironmentToggleState | null;
  chatLayoutAction?: {
    kind: "split" | "maximize";
    label: string;
    shortcutLabel: string | null;
    onClick: () => void;
  } | null;
  changeThreadAction?: {
    label: string;
    onClick: () => void;
  } | null;
  editorChatControls?: EditorChatControls | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
  onCreateHandoff: (targetProvider: ProviderKind) => void;
  onNavigateToThread: (threadId: ThreadId) => void;
  onRenameThread: () => void;
  onCloseThreadPane?: () => void;
  onPromoteSidechat?: () => void;
}
