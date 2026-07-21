import type { ThreadId, TurnId } from "@agent-group/contracts";

import type { SplitViewPanePanelState } from "../../splitViewStore";

export interface ChatViewProps {
  threadId: ThreadId;
  paneScopeId?: string;
  surfaceMode?: "single" | "split";
  presentationMode?: "default" | "editor";
  isFocusedPane?: boolean;
  panelState?: SplitViewPanePanelState;
  onToggleDiffPanel?: () => void;
  onToggleBrowserPanel?: () => void;
  onOpenHighlightsPanel?: () => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenTurnDiffPanel?: (turnId: TurnId, filePath?: string) => void;
  onSplitSurface?: () => void;
  onMaximizeSurface?: () => void;
  viewModeAction?: {
    label: string;
    active: boolean;
    onClick: () => void;
  } | null;
  onChangeThreadInSplitPane?: () => void;
  onCloseThreadPane?: () => void;
  onSidechatPromoted?: (threadId: ThreadId) => Promise<void> | void;
}
