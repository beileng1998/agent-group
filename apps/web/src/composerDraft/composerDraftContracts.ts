// FILE: composerDraftContracts.ts
// Purpose: Define composer runtime contracts and versioned persistence schemas.
// Layer: Web composer state contracts

import {
  MessageMentionReference,
  ModelSelection,
  type OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  OrchestrationThreadPullRequest,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderSkillReference,
  ProviderStartOptions,
  RuntimeMode,
  ThreadId,
} from "@agent-group/contracts";
import * as Schema from "effect/Schema";
import type {
  ChatAssistantSelectionAttachment,
  ChatFileAttachment,
  ChatImageAttachment,
} from "../types";
import type { TerminalContextDraft } from "../lib/terminalContext";
import type { FileCommentDraft } from "../lib/fileComments";
import type { PastedTextDraft } from "../lib/composerPastedText";
import type { ComposerImageSource } from "../lib/composerImageSource";

export const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);
export type DraftThreadEnvMode = typeof DraftThreadEnvModeSchema.Type;
export const DraftThreadEntryPointSchema = Schema.Literals(["chat", "terminal"]);

export const PersistedComposerAppSnapSource = Schema.Struct({
  kind: Schema.Literal("appsnap"),
  captureId: Schema.String,
  capturedAt: Schema.String,
  appName: Schema.NullOr(Schema.String),
  bundleIdentifier: Schema.optionalKey(Schema.NullOr(Schema.String)),
  appIconDataUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  windowTitle: Schema.NullOr(Schema.String),
});
export const LegacyPersistedComposerAppSnapSource = Schema.Struct({
  kind: Schema.Literal("appshot"),
  captureId: Schema.String,
  capturedAt: Schema.String,
  appName: Schema.NullOr(Schema.String),
  bundleIdentifier: Schema.optionalKey(Schema.NullOr(Schema.String)),
  appIconDataUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  windowTitle: Schema.NullOr(Schema.String),
});

export const PersistedComposerImageAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.optionalKey(Schema.String),
  blobKey: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(
    Schema.Union([PersistedComposerAppSnapSource, LegacyPersistedComposerAppSnapSource]),
  ),
});
export type PersistedComposerImageAttachment = typeof PersistedComposerImageAttachment.Type;
export type ComposerAttachmentPersistenceResult = "persisted" | "rejected" | "unverified";

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
  source?: ComposerImageSource | undefined;
}

export interface ComposerFileAttachment extends ChatFileAttachment {
  file: File;
}

export interface ComposerPromptHistorySavedDraft {
  prompt: string;
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
}

export type ComposerAssistantSelectionAttachment = ChatAssistantSelectionAttachment;

export interface QueuedComposerChatTurn {
  id: string;
  kind: "chat";
  createdAt: string;
  previewText: string;
  prompt: string;
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
  assistantSelections: ComposerAssistantSelectionAttachment[];
  terminalContexts: TerminalContextDraft[];
  fileComments: FileCommentDraft[];
  pastedTexts: PastedTextDraft[];
  skills: ProviderSkillReference[];
  mentions: MessageMentionReference[];
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptionsForDispatch?: ProviderStartOptions | undefined;
  sourceProposedPlan?: NonNullable<OrchestrationLatestTurn["sourceProposedPlan"]> | undefined;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
}

export interface RestoredComposerSourceProposedPlan {
  threadId: ThreadId;
  restoredPrompt: string;
  sourceProposedPlan: NonNullable<OrchestrationLatestTurn["sourceProposedPlan"]>;
}

export interface QueuedComposerPlanFollowUp {
  id: string;
  kind: "plan-follow-up";
  createdAt: string;
  previewText: string;
  text: string;
  interactionMode: "default" | "plan";
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptionsForDispatch?: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
}

export type QueuedComposerTurn = QueuedComposerChatTurn | QueuedComposerPlanFollowUp;

export const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});
export type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

export const PersistedQueuedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
  text: Schema.String,
});
export type PersistedQueuedTerminalContextDraft = typeof PersistedQueuedTerminalContextDraft.Type;

// File comments always carry their authored text (no live source to re-derive
// from), so a single schema covers both live drafts and queued turns.
export const PersistedFileCommentDraft = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  text: Schema.String,
});
export type PersistedFileCommentDraft = typeof PersistedFileCommentDraft.Type;

// Pasted text always carries its full content (the chip is the only copy), so a
// single schema covers both live drafts and queued turns. Line/char metrics are
// recomputed on hydration, so they are not persisted.
export const PersistedPastedTextDraft = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  text: Schema.String,
});
export type PersistedPastedTextDraft = typeof PersistedPastedTextDraft.Type;

export const PersistedSourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const PersistedRestoredSourceProposedPlan = Schema.Struct({
  threadId: ThreadId,
  restoredPrompt: Schema.String,
  sourceProposedPlan: PersistedSourceProposedPlanReference,
});

export const PersistedAssistantSelectionDraft = Schema.Struct({
  id: Schema.String,
  assistantMessageId: Schema.String,
  text: Schema.String,
});
export type PersistedAssistantSelectionDraft = typeof PersistedAssistantSelectionDraft.Type;

export const PersistedQueuedComposerChatTurn = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("chat"),
  createdAt: Schema.String,
  previewText: Schema.String,
  prompt: Schema.String,
  images: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(Schema.Array(PersistedAssistantSelectionDraft)),
  terminalContexts: Schema.Array(PersistedQueuedTerminalContextDraft),
  fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
  pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
  skills: Schema.Array(ProviderSkillReference),
  mentions: Schema.Array(MessageMentionReference),
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  sourceProposedPlan: Schema.optionalKey(PersistedSourceProposedPlanReference),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  envMode: DraftThreadEnvModeSchema,
});
export type PersistedQueuedComposerChatTurn = typeof PersistedQueuedComposerChatTurn.Type;

export const PersistedQueuedComposerPlanFollowUp = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("plan-follow-up"),
  createdAt: Schema.String,
  previewText: Schema.String,
  text: Schema.String,
  interactionMode: ProviderInteractionMode,
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  runtimeMode: RuntimeMode,
});
export type PersistedQueuedComposerPlanFollowUp = typeof PersistedQueuedComposerPlanFollowUp.Type;

export const PersistedQueuedComposerTurn = Schema.Union([
  PersistedQueuedComposerChatTurn,
  PersistedQueuedComposerPlanFollowUp,
]);
export type PersistedQueuedComposerTurn = typeof PersistedQueuedComposerTurn.Type;

export const PersistedComposerPromptHistorySavedDraft = Schema.Union([
  Schema.String,
  Schema.Struct({
    prompt: Schema.String,
    attachments: Schema.optionalKey(Schema.Array(PersistedComposerImageAttachment)),
    assistantSelections: Schema.optionalKey(Schema.Array(PersistedAssistantSelectionDraft)),
    terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
    fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
    pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
    skills: Schema.optionalKey(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optionalKey(Schema.Array(MessageMentionReference)),
  }),
]);
export type PersistedComposerPromptHistorySavedDraft =
  typeof PersistedComposerPromptHistorySavedDraft.Type;

export const PersistedComposerThreadDraftState = Schema.Struct({
  prompt: Schema.String,
  // Set only while composer prompt-history browsing is active: the user's real
  // draft snapshot, kept safe while `prompt` temporarily holds a recalled history entry.
  promptHistorySavedDraft: Schema.optionalKey(PersistedComposerPromptHistorySavedDraft),
  attachments: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        assistantMessageId: Schema.String,
        text: Schema.String,
      }),
    ),
  ),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  fileComments: Schema.optionalKey(Schema.Array(PersistedFileCommentDraft)),
  pastedTexts: Schema.optionalKey(Schema.Array(PersistedPastedTextDraft)),
  skills: Schema.optionalKey(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optionalKey(Schema.Array(MessageMentionReference)),
  queuedTurns: Schema.optionalKey(Schema.Array(PersistedQueuedComposerTurn)),
  restoredSourceProposedPlan: Schema.optionalKey(PersistedRestoredSourceProposedPlan),
  modelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  activeProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
});
export type PersistedComposerThreadDraftState = typeof PersistedComposerThreadDraftState.Type;

const LegacyCodexFields = Schema.Struct({
  effort: Schema.optionalKey(Schema.String),
  codexFastMode: Schema.optionalKey(Schema.Boolean),
  serviceTier: Schema.optionalKey(Schema.String),
});
export type LegacyCodexFields = typeof LegacyCodexFields.Type;

const LegacyThreadModelFields = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String),
  modelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
export type LegacyThreadModelFields = typeof LegacyThreadModelFields.Type;

export type LegacyV2ThreadDraftFields = {
  modelSelection?: ModelSelection | null;
  modelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerThreadDraftState = PersistedComposerThreadDraftState &
  LegacyCodexFields &
  LegacyThreadModelFields &
  LegacyV2ThreadDraftFields;

const LegacyStickyModelFields = Schema.Struct({
  stickyProvider: Schema.optionalKey(ProviderKind),
  stickyModel: Schema.optionalKey(Schema.String),
  stickyModelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
export type LegacyStickyModelFields = typeof LegacyStickyModelFields.Type;

export type LegacyV2StoreFields = {
  stickyModelSelection?: ModelSelection | null;
  stickyModelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields;

export const PersistedDraftThreadState = Schema.Struct({
  projectId: ProjectId,
  createdAt: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  entryPoint: DraftThreadEntryPointSchema.pipe(Schema.withDecodingDefault(() => "chat")),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  lastKnownPr: Schema.optionalKey(Schema.NullOr(OrchestrationThreadPullRequest)),
  envMode: DraftThreadEnvModeSchema,
  isTemporary: Schema.optionalKey(Schema.Boolean),
  promotedTo: Schema.optionalKey(ThreadId),
});
export type PersistedDraftThreadState = typeof PersistedDraftThreadState.Type;

export const PersistedComposerDraftStoreState = Schema.Struct({
  draftsByThreadId: Schema.Record(ThreadId, PersistedComposerThreadDraftState),
  draftThreadsByThreadId: Schema.Record(ThreadId, PersistedDraftThreadState),
  projectDraftThreadIdByProjectId: Schema.Record(ProjectId, ThreadId),
  stickyModelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  stickyActiveProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
});
export type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;
