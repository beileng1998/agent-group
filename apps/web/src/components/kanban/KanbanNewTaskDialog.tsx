// FILE: KanbanNewTaskDialog.tsx
// Purpose: Linear-style "New task" dialog — a compact composer that drafts a task
//          (prompt + provider/model/effort + permissions + mode + environment + voice)
//          and drops it into the board's Draft column. Model state is driven through
//          a scratch composer-draft-store thread so the split model + effort/options
//          pickers work exactly like a fresh chat composer; the project's regular
//          composer draft is untouched.
// Layer: Kanban UI component
// Exports: KanbanNewTaskDialog

import type { ProjectId, ProviderKind } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getProviderStartOptions,
  resolveAssistantDeliveryMode,
  useAppSettings,
} from "~/appSettings";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import { ComposerCommandMenu } from "~/components/chat/ComposerCommandMenu";
import {
  ComposerLocalDirectoryMenu,
  type ComposerLocalDirectoryMenuHandle,
} from "~/components/chat/ComposerLocalDirectoryMenu";
import { ComposerReferenceAttachments } from "~/components/chat/ComposerReferenceAttachments";
import { useComposerVoiceController } from "~/components/chat/useComposerVoiceController";
import {
  COMPOSER_COMMAND_MENU_INLINE_WRAPPER_CLASS_NAME,
  COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { Dialog, DialogPanel, DialogPopup } from "~/components/ui/dialog";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useComposerDropzone } from "~/hooks/useComposerDropzone";
import { toastManager } from "~/components/ui/toast";
import { useTheme } from "~/hooks/useTheme";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import { findProviderStatus } from "~/lib/providerAvailability";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { useComposerDraftStore } from "../../composerDraftStore";
import { buildModelSelection } from "../../providerModelOptions";
import { useStore } from "../../store";
import { appendKanbanTaskTranscript, buildKanbanTaskPreview } from "./KanbanNewTaskDialog.logic";
import { KanbanTaskExpandedImageOverlay } from "./KanbanTaskExpandedImageOverlay";
import {
  KanbanNewTaskDialogFooter,
  KanbanNewTaskDialogHeader,
} from "./new-task-dialog/KanbanNewTaskDialogChrome";
import {
  EMPTY_COMPOSER_FILES,
  ignoreComposerFileRemoval,
  type KanbanNewTaskDialogProps,
  type KanbanNewTaskProjectOption,
} from "./new-task-dialog/KanbanNewTaskDialog.model";
import { useKanbanNewTaskDialogFormState } from "./new-task-dialog/useKanbanNewTaskDialogFormState";
import { useKanbanTaskComposerMenu } from "./useKanbanTaskComposerMenu";
import { useKanbanTaskScratchDraft } from "./useKanbanTaskScratchDraft";
import { useKanbanTaskSubmit } from "./useKanbanTaskSubmit";

export type { KanbanNewTaskDialogProps, KanbanNewTaskProjectOption };

/**
 * Mount with a fresh `key` per open so all draft state initializes lazily; closing
 * is signalled through onOpenChange(false) and the parent unmounts the dialog.
 */
export function KanbanNewTaskDialog({
  onOpenChange,
  projectOptions,
  initialProjectId,
  initialSendAsDraft = false,
}: KanbanNewTaskDialogProps) {
  const { settings } = useAppSettings();
  const { resolvedTheme } = useTheme();
  const assistantDeliveryMode = resolveAssistantDeliveryMode(settings);
  const providerOptionsForDispatch = useMemo(() => getProviderStartOptions(settings), [settings]);
  const projects = useStore((state) => state.projects);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const localDirectoryMenuRef = useRef<ComposerLocalDirectoryMenuHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(
    () => initialProjectId ?? projectOptions[0]?.id ?? null,
  );
  const {
    scratchThreadId,
    prompt,
    composerImages,
    composerAssistantSelections,
    composerFileComments,
    composerTerminalContexts,
    composerSkills,
    composerMentions,
    nonPersistedComposerImageIdSet,
    selectedProvider,
    selectedModel,
    selectedProviderModelOptions,
    setPrompt,
    handleProviderModelChange,
    addComposerImages,
    removeComposerImage,
    clearComposerAssistantSelections,
    clearComposerFileComments,
    removeComposerTerminalContext,
  } = useKanbanTaskScratchDraft({ defaultProvider: settings.defaultProvider });
  const promptRef = useRef(prompt);

  const {
    runtimeMode,
    setRuntimeMode,
    interactionMode,
    setInteractionMode,
    envMode,
    setEnvMode,
    sendAsDraft,
    setSendAsDraft,
    isModelPickerOpen,
    setIsModelPickerOpen,
    isTraitsPickerOpen,
    setIsTraitsPickerOpen,
    isDragOverComposer,
    setIsDragOverComposer,
    expandedImage,
    setExpandedImage,
    closeExpandedImage,
    navigateExpandedImage,
  } = useKanbanNewTaskDialogFormState(initialSendAsDraft);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: selectedProject?.cwd ?? null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });

  // Voice transcription always rides on the Codex ChatGPT session, regardless of
  // which provider the task targets — gate the mic on the Codex status.
  const voiceProviderStatus = useMemo(
    () => findProviderStatus(providerStatuses, "codex"),
    [providerStatuses],
  );

  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [selectedProvider]: selectedModel }),
    [selectedProvider, selectedModel],
  );
  const {
    modelOptionsByProvider,
    loadingModelProviders,
    runtimeModelsByProvider,
    selectedRuntimeModel,
    selectedRuntimeAgents,
  } = useProviderModelCatalog({
    selectedProvider,
    // Keep discovery warm whenever either picker can open so cursor/codex effort
    // and fast-mode controls are populated, not just the model list.
    discoveryEnabled: isModelPickerOpen || isTraitsPickerOpen,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });
  const trimmedPrompt = prompt.trim();
  const hasSendableContent =
    trimmedPrompt.length > 0 ||
    composerImages.length > 0 ||
    composerAssistantSelections.length > 0 ||
    composerFileComments.length > 0 ||
    composerTerminalContexts.some((context) => context.text.trim().length > 0);
  const taskPreview = buildKanbanTaskPreview({
    trimmedPrompt,
    firstImageName: composerImages[0]?.name,
    assistantSelectionCount: composerAssistantSelections.length,
  });
  const { canCreate, isCreating, handleCreate } = useKanbanTaskSubmit({
    selectedProjectId,
    hasSendableContent,
    selectedProvider,
    selectedModel,
    taskPreview,
    trimmedPrompt,
    scratchThreadId,
    runtimeMode,
    interactionMode,
    envMode,
    sendAsDraft,
    defaultProvider: settings.defaultProvider,
    assistantDeliveryMode,
    providerOptionsForDispatch,
    providerStatuses,
    onOpenChange,
  });
  const handleCreateRequest = useCallback(() => {
    void handleCreate();
  }, [handleCreate]);
  const {
    composerCursor,
    composerTrigger,
    mentionTriggerQuery,
    isLocalFolderBrowserOpen,
    localFolderBrowseRootPath,
    composerMenuItems,
    activeComposerMenuItem,
    isComposerMenuLoading,
    setComposerHighlightedItemId,
    scheduleComposerFocus,
    setPromptAtEnd,
    appendComposerPromptText,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    onSelectComposerItem,
    onPromptChange,
    onComposerCommandKey,
  } = useKanbanTaskComposerMenu({
    prompt,
    promptRef,
    setPrompt,
    composerEditorRef,
    localDirectoryMenuRef,
    composerTerminalContexts,
    composerSkills,
    composerMentions,
    scratchThreadId,
    selectedProvider,
    modelOptionsByProvider,
    selectedRuntimeAgents,
    selectedProjectCwd: selectedProject?.cwd ?? null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
    serverHomeDir: serverConfigQuery.data?.homeDir ?? null,
    providerOptionsForDispatch,
    hiddenProviders: settings.hiddenProviders,
    providerOrder: settings.providerOrder,
    piAgentDir: settings.piAgentDir || null,
    handleProviderModelChange,
    setInteractionMode,
    onCreate: handleCreateRequest,
  });

  // Providers without a static default (e.g. Pi) resolve their model once
  // discovery delivers the catalog.
  useEffect(() => {
    if (selectedModel !== null) {
      return;
    }
    const firstOption = modelOptionsByProvider[selectedProvider][0];
    if (firstOption) {
      useComposerDraftStore
        .getState()
        .setModelSelection(
          scratchThreadId,
          buildModelSelection(selectedProvider, firstOption.slug),
        );
    }
  }, [modelOptionsByProvider, scratchThreadId, selectedModel, selectedProvider]);

  const handleTranscriptReady = useCallback(
    (transcript: string) => {
      const nextPrompt = appendKanbanTaskTranscript(promptRef.current, transcript);
      setPromptAtEnd(nextPrompt);
    },
    [setPromptAtEnd],
  );
  const voice = useComposerVoiceController({
    activeProject: selectedProject ?? undefined,
    activeThreadId: null,
    threadId: scratchThreadId,
    selectedProvider,
    activeProviderStatus: voiceProviderStatus,
    pendingUserInputCount: 0,
    onTranscriptReady: handleTranscriptReady,
    refreshVoiceStatus: refreshProviderStatuses,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      composerEditorRef.current?.focusAtEnd();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  // Cmd/Ctrl+Enter submits from anywhere in the dialog, not just the textarea —
  // the focus is often on a picker (model/effort/project) when the user commits.
  const handleSubmitShortcut = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleCreateRequest();
      }
    },
    [handleCreateRequest],
  );

  const {
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
  } = useComposerDropzone({
    addImages: addComposerImages,
    fileSupport: {
      genericFiles: "reject",
      onUnsupportedFiles: (files) => {
        toastManager.add({
          type: "warning",
          title: "Only images can be attached to new tasks.",
          description:
            files.length === 1
              ? "That file was not added."
              : `${files.length} files were not added.`,
        });
      },
    },
    appendReferenceText: appendComposerPromptText,
    appendPathMentions: (paths) => {
      for (const absolutePath of paths) {
        appendComposerPromptText(formatComposerMentionToken(absolutePath));
      }
    },
    dragDepthRef,
    focusComposer: scheduleComposerFocus,
    setIsDragOverComposer,
  });

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      addComposerImages(Array.from(event.currentTarget.files ?? []));
      event.currentTarget.value = "";
      scheduleComposerFocus();
    },
    [addComposerImages, scheduleComposerFocus],
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup
        surface="solid"
        className="max-w-3xl rounded-3xl"
        onKeyDown={handleSubmitShortcut}
      >
        {/* Linear-style breadcrumb header: project chip › title, same type size. */}
        <KanbanNewTaskDialogHeader
          projectOptions={projectOptions}
          selectedProjectId={selectedProjectId}
          onProjectIdChange={setSelectedProjectId}
        />
        {/* Flush, borderless composer body: same Lexical prompt editor and attachment row as chat. */}
        <DialogPanel
          className="px-4 pt-2 pb-2"
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
        >
          <div
            className={cn(
              "relative min-h-28 rounded-lg border border-transparent px-0 py-1 transition-colors",
              isDragOverComposer && "border-sky-400/40 bg-sky-500/5",
            )}
          >
            {composerTrigger ? (
              <div className={COMPOSER_COMMAND_MENU_INLINE_WRAPPER_CLASS_NAME}>
                {isLocalFolderBrowserOpen ? (
                  <ComposerLocalDirectoryMenu
                    mentionQuery={mentionTriggerQuery}
                    rootLabel={localFolderBrowseRootPath ?? "Local folders unavailable"}
                    homeDir={serverConfigQuery.data?.homeDir ?? null}
                    onSelectEntry={(absolutePath) =>
                      handleSelectLocalDirectoryMention(absolutePath)
                    }
                    onNavigateFolder={handleNavigateLocalFolder}
                    handleRef={localDirectoryMenuRef}
                  />
                ) : (
                  <ComposerCommandMenu
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    triggerKind={composerTrigger.kind}
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={setComposerHighlightedItemId}
                    onSelect={onSelectComposerItem}
                  />
                )}
              </div>
            ) : null}
            <ComposerReferenceAttachments
              assistantSelections={composerAssistantSelections}
              fileComments={composerFileComments}
              files={EMPTY_COMPOSER_FILES}
              images={composerImages}
              nonPersistedImageIdSet={nonPersistedComposerImageIdSet}
              onExpandImage={setExpandedImage}
              onRemoveAssistantSelections={clearComposerAssistantSelections}
              onRemoveFileComments={clearComposerFileComments}
              onRemoveFile={ignoreComposerFileRemoval}
              onRemoveImage={removeComposerImage}
            />
            <ComposerPromptEditor
              ref={composerEditorRef}
              value={prompt}
              cursor={composerCursor}
              terminalContexts={composerTerminalContexts}
              mentionReferences={composerMentions}
              disabled={voice.isVoiceTranscribing}
              placeholder="Describe the task, @tag files/folders, paste images, or use / for skills"
              className={cn(
                COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
                COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                "px-0 py-0 text-sm",
              )}
              onRemoveTerminalContext={removeComposerTerminalContext}
              onChange={onPromptChange}
              onCommandKeyDown={onComposerCommandKey}
              onPaste={onComposerPaste}
            />
          </div>
        </DialogPanel>
        {/* Linear-style footer (not DialogFooter, whose !important button overrides
            would deform the chips): a chips row mirroring the chat composer
            (`+` extras + permissions left, model + effort right), then a hairline
            separator and a compact bottom bar with voice on the left and the
            create controls on the right. */}
        <KanbanNewTaskDialogFooter
          voice={voice}
          extrasMenuProps={{
            interactionMode,
            onInteractionModeChange: setInteractionMode,
            envMode,
            onEnvModeChange: setEnvMode,
          }}
          runtimeUsageProps={{
            runtimeMode,
            onRuntimeModeChange: setRuntimeMode,
          }}
          modelPickerProps={{
            compact: true,
            provider: selectedProvider,
            model: selectedModel ?? "",
            lockedProvider: null,
            providers: providerStatuses,
            modelOptionsByProvider,
            loadingModelProviders,
            hiddenProviders: settings.hiddenProviders,
            providerOrder: settings.providerOrder,
            onProviderModelChange: handleProviderModelChange,
            open: isModelPickerOpen,
            onOpenChange: setIsModelPickerOpen,
          }}
          traitsPickerProps={{
            provider: selectedProvider,
            threadId: scratchThreadId,
            model: selectedModel,
            runtimeModel: selectedRuntimeModel,
            runtimeModels: runtimeModelsByProvider[selectedProvider],
            runtimeAgents: selectedRuntimeAgents,
            modelOptions: selectedProviderModelOptions,
            prompt,
            onPromptChange: setPrompt,
            open: isTraitsPickerOpen,
            onOpenChange: setIsTraitsPickerOpen,
          }}
          fileInputRef={fileInputRef}
          onFileInputChange={onFileInputChange}
          hasSelectedProject={selectedProject !== null}
          sendAsDraft={sendAsDraft}
          onSendAsDraftChange={setSendAsDraft}
          canCreate={canCreate}
          isCreating={isCreating}
          onCreate={handleCreateRequest}
        />
        <KanbanTaskExpandedImageOverlay
          expandedImage={expandedImage}
          onClose={closeExpandedImage}
          onNavigate={navigateExpandedImage}
        />
      </DialogPopup>
    </Dialog>
  );
}
