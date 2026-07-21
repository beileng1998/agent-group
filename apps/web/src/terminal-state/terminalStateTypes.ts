import type { ThreadId } from "@agent-group/contracts";
import type { TerminalActivityState, TerminalCliKind } from "@agent-group/shared/terminalThreads";
import type {
  ThreadPrimarySurface,
  ThreadTerminalGroup,
  ThreadTerminalPresentationMode,
  ThreadTerminalWorkspaceLayout,
  ThreadTerminalWorkspaceTab,
} from "../types";
import type { WorkspaceLayoutPresetId } from "../workspaceTerminalLayoutPresets";

export const TERMINAL_STATE_STORAGE_KEY = "agent-group:terminal-state:v1";

export interface ThreadTerminalState {
  entryPoint: ThreadPrimarySurface;
  terminalOpen: boolean;
  presentationMode: ThreadTerminalPresentationMode;
  workspaceLayout: ThreadTerminalWorkspaceLayout;
  workspaceActiveTab: ThreadTerminalWorkspaceTab;
  terminalHeight: number;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
}

export interface TerminalStateStoreState {
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>;
  openChatThreadPage: (threadId: ThreadId) => void;
  openTerminalThreadPage: (threadId: ThreadId, options?: { terminalOnly?: boolean }) => void;
  setTerminalOpen: (threadId: ThreadId, open: boolean) => void;
  setTerminalPresentationMode: (threadId: ThreadId, mode: ThreadTerminalPresentationMode) => void;
  setTerminalWorkspaceLayout: (threadId: ThreadId, layout: ThreadTerminalWorkspaceLayout) => void;
  setTerminalWorkspaceTab: (threadId: ThreadId, tab: ThreadTerminalWorkspaceTab) => void;
  setTerminalHeight: (threadId: ThreadId, height: number) => void;
  setTerminalMetadata: (
    threadId: ThreadId,
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  setTerminalCliKind: (
    threadId: ThreadId,
    terminalId: string,
    cliKind: TerminalCliKind | null,
  ) => void;
  setTerminalTitleOverride: (
    threadId: ThreadId,
    terminalId: string,
    titleOverride: string | null | undefined,
  ) => void;
  splitTerminal: (threadId: ThreadId, terminalId: string) => void;
  splitTerminalLeft: (threadId: ThreadId, terminalId: string) => void;
  splitTerminalRight: (threadId: ThreadId, terminalId: string) => void;
  splitTerminalDown: (threadId: ThreadId, terminalId: string) => void;
  splitTerminalUp: (threadId: ThreadId, terminalId: string) => void;
  newTerminal: (threadId: ThreadId, terminalId: string) => void;
  newTerminalTab: (threadId: ThreadId, targetTerminalId: string, terminalId: string) => void;
  openNewFullWidthTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeWorkspaceChat: (threadId: ThreadId) => void;
  setActiveTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeTerminalGroup: (threadId: ThreadId, groupId: string) => void;
  resizeTerminalSplit: (
    threadId: ThreadId,
    groupId: string,
    splitId: string,
    weights: number[],
  ) => void;
  setTerminalActivity: (
    threadId: ThreadId,
    terminalId: string,
    activity: { agentState: TerminalActivityState | null; hasRunningSubprocess: boolean },
  ) => void;
  applyWorkspaceLayoutPreset: (
    threadId: ThreadId,
    presetId: WorkspaceLayoutPresetId,
    terminalIds: readonly string[],
  ) => void;
  clearTerminalState: (threadId: ThreadId) => void;
  removeOrphanedTerminalStates: (activeThreadIds: Set<ThreadId>) => void;
}
