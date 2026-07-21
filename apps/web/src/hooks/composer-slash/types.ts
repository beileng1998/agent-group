// FILE: types.ts
// Purpose: Contracts shared by composer slash-command controllers.
// Layer: Web composer application logic

import type {
  ModelSelection,
  OrchestrationShellSnapshot,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderNativeCommandDescriptor,
  RuntimeMode,
  ThreadId,
} from "@agent-group/contracts";
import type { ComposerTrigger } from "../../composer-logic";
import type { SplitViewId } from "../../splitViewStore";
import type { Project, Thread } from "../../types";

export type ComposerSnapshot = {
  value: string;
  cursor: number;
  expandedCursor: number;
};

export type ComposerSlashEditorActions = {
  resolveActiveComposerTrigger: () => {
    snapshot: ComposerSnapshot;
    trigger: ComposerTrigger | null;
  };
  applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { expectedText?: string; cursorOffset?: number },
  ) => number | false;
  clearComposerSlashDraft: () => void;
  setComposerPromptValue: (nextPrompt: string) => void;
  scheduleComposerFocus: () => void;
  setComposerHighlightedItemId: (id: string | null) => void;
};

export type ComposerSlashCommandsInput = {
  activeProject: Project | undefined;
  activeThread: Thread | undefined;
  activeRootBranch: string | null;
  isServerThread: boolean;
  supportsFastSlashCommand: boolean;
  canOfferCompactCommand: boolean;
  canOfferSideCommand: boolean;
  canOfferExportCommand: boolean;
  surfaceAppSlashCommands?: ReadonlySet<string>;
  supportsTextNativeReviewCommand: boolean;
  fastModeEnabled: boolean;
  providerNativeCommands: readonly ProviderNativeCommandDescriptor[];
  providerCommandDiscoveryCwd: string | null;
  selectedProvider: ProviderKind;
  currentProviderModelOptions: ProviderModelOptions[ProviderKind] | undefined;
  selectedModelSelection: ModelSelection;
  environmentMode: string | null;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  threadId: ThreadId;
  syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  navigateToThread: (threadId: ThreadId, options?: { splitViewId?: SplitViewId }) => Promise<void>;
  handleClearConversation: () => Promise<void> | void;
  handleInteractionModeChange: (mode: "default" | "plan") => Promise<void> | void;
  openForkTargetPicker: () => void;
  openReviewTargetPicker: () => void;
  setComposerDraftProviderModelOptions: (
    threadId: ThreadId,
    provider: ProviderKind,
    nextProviderOptions: ProviderModelOptions[ProviderKind],
    options?: { persistSticky?: boolean },
  ) => void;
  editorActions: ComposerSlashEditorActions;
};
