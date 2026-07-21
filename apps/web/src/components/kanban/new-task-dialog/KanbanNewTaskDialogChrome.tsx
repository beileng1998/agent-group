import type { ProjectId } from "@agent-group/contracts";
import type { ChangeEventHandler, ComponentProps, RefObject } from "react";

import { RuntimeUsageControls } from "~/components/BranchToolbar";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import { ComposerVoiceButton } from "~/components/chat/ComposerVoiceButton";
import { ComposerVoiceRecorderBar } from "~/components/chat/ComposerVoiceRecorderBar";
import type { useComposerVoiceController } from "~/components/chat/useComposerVoiceController";
import { Button } from "~/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { ChevronRightIcon, PaperclipIcon } from "~/lib/icons";

import { KanbanTaskExtrasMenu } from "../KanbanTaskExtrasMenu";
import { KanbanTaskProjectPicker } from "../KanbanTaskProjectPicker";
import type { KanbanNewTaskProjectOption } from "./KanbanNewTaskDialog.model";

interface KanbanNewTaskDialogHeaderProps {
  projectOptions: ReadonlyArray<KanbanNewTaskProjectOption>;
  selectedProjectId: ProjectId | null;
  onProjectIdChange: (projectId: ProjectId) => void;
}

export function KanbanNewTaskDialogHeader({
  projectOptions,
  selectedProjectId,
  onProjectIdChange,
}: KanbanNewTaskDialogHeaderProps) {
  return (
    <DialogHeader className="px-4 pt-3.5 pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <KanbanTaskProjectPicker
          projectOptions={projectOptions}
          selectedProjectId={selectedProjectId}
          onProjectIdChange={onProjectIdChange}
        />
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
        <DialogTitle className="font-system-ui truncate font-medium text-[length:var(--app-font-size-ui,12px)] leading-none">
          New task
        </DialogTitle>
      </div>
      <DialogDescription className="sr-only">
        Draft a prompt and place it in the board&apos;s Draft column. Drag it to In Progress to send
        it.
      </DialogDescription>
    </DialogHeader>
  );
}

type VoiceController = ReturnType<typeof useComposerVoiceController>;

interface KanbanNewTaskDialogFooterProps {
  voice: VoiceController;
  extrasMenuProps: ComponentProps<typeof KanbanTaskExtrasMenu>;
  runtimeUsageProps: ComponentProps<typeof RuntimeUsageControls>;
  modelPickerProps: ComponentProps<typeof ProviderModelPicker>;
  traitsPickerProps: ComponentProps<typeof TraitsPicker>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: ChangeEventHandler<HTMLInputElement>;
  hasSelectedProject: boolean;
  sendAsDraft: boolean;
  onSendAsDraftChange: (sendAsDraft: boolean) => void;
  canCreate: boolean;
  isCreating: boolean;
  onCreate: () => void;
}

export function KanbanNewTaskDialogFooter({
  voice,
  extrasMenuProps,
  runtimeUsageProps,
  modelPickerProps,
  traitsPickerProps,
  fileInputRef,
  onFileInputChange,
  hasSelectedProject,
  sendAsDraft,
  onSendAsDraftChange,
  canCreate,
  isCreating,
  onCreate,
}: KanbanNewTaskDialogFooterProps) {
  const isVoiceActive = voice.isVoiceRecording || voice.isVoiceTranscribing;

  return (
    <div className="flex w-full flex-col">
      <div className="px-4 pb-2.5">
        {isVoiceActive ? (
          <ComposerVoiceRecorderBar
            durationLabel={voice.voiceRecordingDurationLabel}
            isRecording={voice.isVoiceRecording}
            isTranscribing={voice.isVoiceTranscribing}
            waveformLevels={voice.voiceWaveformLevels}
            onCancel={voice.cancelComposerVoiceRecording}
            onSubmit={() => void voice.submitComposerVoiceRecording()}
          />
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <KanbanTaskExtrasMenu {...extrasMenuProps} />
              <RuntimeUsageControls {...runtimeUsageProps} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Same split controls as a fresh chat composer: model picker plus
                  the separate effort/thinking/speed picker. */}
              <ProviderModelPicker {...modelPickerProps} />
              <TraitsPicker {...traitsPickerProps} />
            </div>
          </div>
        )}
      </div>
      <div className="flex w-full items-center justify-between gap-2 border-t border-[color:var(--color-border-light)] px-4 py-2.5">
        <div className="flex min-w-0 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          {!isVoiceActive ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="mr-1 shrink-0 text-muted-foreground/70 hover:text-foreground"
              aria-label="Attach images"
              title="Attach images"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon className="size-4" />
            </Button>
          ) : null}
          {!isVoiceActive && voice.showVoiceNotesControl ? (
            <ComposerVoiceButton
              disabled={!hasSelectedProject}
              isRecording={voice.isVoiceRecording}
              isTranscribing={voice.isVoiceTranscribing}
              durationLabel={voice.voiceRecordingDurationLabel}
              onClick={() => void voice.startComposerVoiceRecording()}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={sendAsDraft}
              onCheckedChange={(checked) => onSendAsDraftChange(checked === true)}
            />
            Send as draft
          </label>
          <Button size="sm" onClick={onCreate} disabled={!canCreate}>
            {isCreating ? "Creating..." : "Create task"}
          </Button>
        </div>
      </div>
    </div>
  );
}
