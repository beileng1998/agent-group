// FILE: composerDraftStore.ts
// Purpose: Preserve the public composer-draft API while domain owners stay independent.
// Layer: Web state compatibility facade

export * from "./composerDraft/composerDraftContracts";
export type * from "./composerDraft/composerDraftState";
export {
  findSupersededComposerImageBlobAttachments,
  isComposerImageBlobReferenced,
} from "./composerDraft/composerDraftImageLifecycle";
export { captureComposerPromptHistorySavedDraft } from "./composerDraft/composerDraftContentState";
export {
  deriveEffectiveComposerModelState,
  resolvePreferredComposerModelSelection,
} from "./composerDraft/composerDraftModelState";
export { COMPOSER_DRAFT_STORAGE_KEY } from "./composerDraft/composerDraftAttachmentPersistence";
export { useComposerDraftStore } from "./composerDraft/composerDraftStoreRoot";
export {
  finalizePromotedDraftThreads,
  markPromotedDraftThreads,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "./composerDraft/composerDraftHooks";
