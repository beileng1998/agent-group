// FILE: composerDraftState.ts
// Purpose: Define the composer Zustand state shape and draft-thread metadata.
// Layer: Web composer state contracts

import type {
  MessageMentionReference,
  ModelSelection,
  ModelSlug,
  OrchestrationThreadPullRequest,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderSkillReference,
  RuntimeMode,
  ThreadId,
} from "@agent-group/contracts";
import type { ThreadPrimarySurface } from "../types";
import type { TerminalContextDraft } from "../lib/terminalContext";
import type { FileCommentDraft } from "../lib/fileComments";
import type { PastedTextDraft } from "../lib/composerPastedText";
import type {
  ComposerAssistantSelectionAttachment,
  ComposerAttachmentPersistenceResult,
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerPromptHistorySavedDraft,
  PersistedComposerImageAttachment,
  QueuedComposerTurn,
  RestoredComposerSourceProposedPlan,
  DraftThreadEnvMode,
} from "./composerDraftContracts";

export interface ComposerThreadDraftState {
  prompt: string;
  // Non-null only while composer prompt-history browsing is active: the user's
  // real draft, kept safe while `prompt` temporarily holds a recalled history
  // entry. Restored (and cleared) when a browse is interrupted by a thread
  // switch or reload.
  promptHistorySavedDraft: ComposerPromptHistorySavedDraft | null;
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
  nonPersistedImageIds: string[];
  persistedAttachments: PersistedComposerImageAttachment[];
  assistantSelections: ComposerAssistantSelectionAttachment[];
  terminalContexts: TerminalContextDraft[];
  fileComments: FileCommentDraft[];
  pastedTexts: PastedTextDraft[];
  skills: ProviderSkillReference[];
  mentions: MessageMentionReference[];
  queuedTurns: QueuedComposerTurn[];
  restoredSourceProposedPlan?: RestoredComposerSourceProposedPlan | null;
  modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
  activeProvider: ProviderKind | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
}

export interface DraftThreadState {
  projectId: ProjectId;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  entryPoint: ThreadPrimarySurface;
  branch: string | null;
  worktreePath: string | null;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  envMode: DraftThreadEnvMode;
  isTemporary?: boolean;
  promotedTo?: ThreadId;
}

export interface DraftThreadMutationOptions {
  branch?: string | null;
  worktreePath?: string | null;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  createdAt?: string;
  envMode?: DraftThreadEnvMode;
  runtimeMode?: RuntimeMode;
  interactionMode?: ProviderInteractionMode;
  entryPoint?: ThreadPrimarySurface;
  isTemporary?: boolean;
}

export type DraftThreadCreatedAtMode = "accept-empty" | "preserve-existing-on-empty";

export interface ProjectDraftThread extends DraftThreadState {
  threadId: ThreadId;
}

export interface ComposerDraftStoreState {
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  projectDraftThreadIdByProjectId: Record<string, ThreadId>;
  stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
  stickyActiveProvider: ProviderKind | null;
  getDraftThreadByProjectId: (
    projectId: ProjectId,
    entryPoint?: ThreadPrimarySurface,
  ) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: DraftThreadMutationOptions,
  ) => void;
  /**
   * Registers a standalone draft thread without claiming the project's
   * composer-draft mapping. Unlike setProjectDraftThreadId this never replaces
   * (and therefore never deletes) the mapped draft, so any number of standalone
   * drafts — e.g. kanban tasks — can coexist per project. Create-only: an
   * existing draft thread is left untouched.
   */
  registerDraftThread: (
    threadId: ThreadId,
    options: {
      projectId: ProjectId;
      createdAt?: string;
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      entryPoint?: ThreadPrimarySurface;
      isTemporary?: boolean;
    },
  ) => void;
  setDraftThreadContext: (
    threadId: ThreadId,
    options: DraftThreadMutationOptions & { projectId?: ProjectId },
  ) => void;
  /**
   * Moves an existing draft into a project's primary draft slot while deleting
   * the draft that used to occupy that slot, if no other project still maps it.
   */
  moveDraftThreadToProject: (
    threadId: ThreadId,
    projectId: ProjectId,
    options?: DraftThreadMutationOptions,
  ) => void;
  clearProjectDraftThreadId: (projectId: ProjectId, entryPoint?: ThreadPrimarySurface) => void;
  clearProjectDraftThreads: (projectId: ProjectId) => void;
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void;
  markDraftThreadPromoting: (threadId: ThreadId, promotedTo?: ThreadId) => void;
  finalizePromotedDraftThread: (threadId: ThreadId) => void;
  clearDraftThread: (threadId: ThreadId) => void;
  setStickyModelSelection: (modelSelection: ModelSelection | null | undefined) => void;
  setPrompt: (threadId: ThreadId, prompt: string) => void;
  setPromptHistorySavedDraft: (
    threadId: ThreadId,
    savedDraft: ComposerPromptHistorySavedDraft | null,
  ) => void;
  restorePromptHistorySavedDraft: (threadId: ThreadId) => void;
  addPromptHistorySavedDraftImage: (threadId: ThreadId, image: ComposerImageAttachment) => void;
  syncPromptHistorySavedDraftPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
  ) => Promise<ComposerAttachmentPersistenceResult>;
  setTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;
  setSkills: (threadId: ThreadId, skills: ProviderSkillReference[]) => void;
  setMentions: (threadId: ThreadId, mentions: MessageMentionReference[]) => void;
  setModelSelection: (
    threadId: ThreadId,
    modelSelection: ModelSelection | null | undefined,
  ) => void;
  setModelSelectionAndSticky: (threadId: ThreadId, modelSelection: ModelSelection) => void;
  setModelOptions: (
    threadId: ThreadId,
    modelOptions: ProviderModelOptions | null | undefined,
  ) => void;
  applyStickyState: (threadId: ThreadId) => void;
  setProviderModelOptions: (
    threadId: ThreadId,
    provider: ProviderKind,
    nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
    options?: {
      model?: string | null;
      persistSticky?: boolean;
    },
  ) => void;
  setRuntimeMode: (threadId: ThreadId, runtimeMode: RuntimeMode | null | undefined) => void;
  setInteractionMode: (
    threadId: ThreadId,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  enqueueQueuedTurn: (threadId: ThreadId, queuedTurn: QueuedComposerTurn) => void;
  insertQueuedTurn: (threadId: ThreadId, queuedTurn: QueuedComposerTurn, index: number) => void;
  removeQueuedTurn: (threadId: ThreadId, queuedTurnId: string) => void;
  addImage: (threadId: ThreadId, image: ComposerImageAttachment) => void;
  addImages: (threadId: ThreadId, images: ComposerImageAttachment[]) => void;
  removeImage: (threadId: ThreadId, imageId: string) => void;
  removeAppSnapCapture: (captureId: string) => void;
  addFiles: (threadId: ThreadId, files: ComposerFileAttachment[]) => void;
  removeFile: (threadId: ThreadId, fileId: string) => void;
  addAssistantSelection: (
    threadId: ThreadId,
    selection: ComposerAssistantSelectionAttachment,
  ) => boolean;
  removeAssistantSelection: (threadId: ThreadId, selectionId: string) => void;
  clearAssistantSelections: (threadId: ThreadId) => void;
  addFileComment: (threadId: ThreadId, comment: FileCommentDraft) => boolean;
  removeFileComment: (threadId: ThreadId, commentId: string) => void;
  clearFileComments: (threadId: ThreadId) => void;
  addPastedTexts: (threadId: ThreadId, pastedTexts: PastedTextDraft[]) => void;
  removePastedText: (threadId: ThreadId, pastedTextId: string) => void;
  clearPastedTexts: (threadId: ThreadId) => void;
  insertTerminalContext: (
    threadId: ThreadId,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  addTerminalContext: (threadId: ThreadId, context: TerminalContextDraft) => void;
  addTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;
  removeTerminalContext: (threadId: ThreadId, contextId: string) => void;
  clearTerminalContexts: (threadId: ThreadId) => void;
  clearPersistedAttachments: (threadId: ThreadId) => void;
  syncPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
  ) => Promise<ComposerAttachmentPersistenceResult>;
  copyTransferableComposerState: (sourceThreadId: ThreadId, targetThreadId: ThreadId) => void;
  setRestoredSourceProposedPlan: (
    threadId: ThreadId,
    source: RestoredComposerSourceProposedPlan | null,
  ) => void;
  clearComposerContent: (
    threadId: ThreadId,
    options?: { readonly preservePreviewUrls?: boolean },
  ) => void;
}

export interface EffectiveComposerModelState {
  selectedModel: ModelSlug;
  modelOptions: ProviderModelOptions | null;
}

export type ComposerDraftStoreSet = (
  partial:
    | ComposerDraftStoreState
    | Partial<ComposerDraftStoreState>
    | ((
        state: ComposerDraftStoreState,
      ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
  replace?: false,
) => void;

export type ComposerDraftStoreGet = () => ComposerDraftStoreState;
