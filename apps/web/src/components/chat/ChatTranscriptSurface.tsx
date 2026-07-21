// FILE: ChatTranscriptSurface.tsx
// Purpose: Render the empty landing or transcript surface from grouped presentation models.
// Layer: Chat transcript presentation

import type { ComponentProps, ReactNode } from "react";

import BranchToolbar from "../BranchToolbar";
import { PullRequestThreadDialog } from "../PullRequestThreadDialog";
import { CenteredEmptyLanding } from "./CenteredEmptyLanding";
import { ComposerLeadingControls, type ComposerLeadingControlsModel } from "./ChatComposerSection";
import { ChatTranscriptPane } from "./ChatTranscriptPane";
import { ComposerAccessoryRow } from "./ComposerAccessoryRow";
import { TranscriptComposerDock } from "./TranscriptComposerDock";

interface ChatTranscriptSurfaceVisibility {
  shouldRenderContent: boolean;
  centeredEmptyLanding: boolean;
  secondaryChromeReady: boolean;
  rightInsetPx?: number;
}

interface ChatTranscriptSurfaceAccessoryModel {
  relocateLeadingControls: boolean;
  leadingControls: ComposerLeadingControlsModel;
  showLegacyBranchToolbar: boolean;
  branchToolbar: Omit<ComponentProps<typeof BranchToolbar>, "className">;
}

export interface ChatTranscriptSurfaceModel {
  visibility: ChatTranscriptSurfaceVisibility;
  landing: Omit<ComponentProps<typeof CenteredEmptyLanding>, "children">;
  transcript: Omit<ComponentProps<typeof ChatTranscriptPane>, "contentInsetRightPx">;
  composer: ReactNode;
  accessory: ChatTranscriptSurfaceAccessoryModel;
  pullRequest: ComponentProps<typeof PullRequestThreadDialog> | null;
}

export function ChatTranscriptSurface({ model }: { model: ChatTranscriptSurfaceModel }) {
  const { visibility, landing, transcript, composer, accessory, pullRequest } = model;
  const relocatedLeadingControls = accessory.relocateLeadingControls ? (
    <ComposerLeadingControls model={accessory.leadingControls} iconOnly />
  ) : null;

  return (
    <>
      {visibility.shouldRenderContent && visibility.centeredEmptyLanding ? (
        <CenteredEmptyLanding {...landing}>
          {composer}
          <ComposerAccessoryRow
            variant="landing"
            leadingControls={relocatedLeadingControls}
            branchToolbar={
              accessory.showLegacyBranchToolbar && !visibility.centeredEmptyLanding ? (
                <BranchToolbar {...accessory.branchToolbar} className="min-w-0 flex-1" />
              ) : null
            }
          />
        </CenteredEmptyLanding>
      ) : null}

      {visibility.shouldRenderContent && !visibility.centeredEmptyLanding ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatTranscriptPane
              {...transcript}
              {...(visibility.rightInsetPx !== undefined
                ? { contentInsetRightPx: visibility.rightInsetPx }
                : {})}
            />
          </div>

          <TranscriptComposerDock
            hasTrailingToolbar={accessory.showLegacyBranchToolbar}
            {...(visibility.rightInsetPx !== undefined
              ? { rightInsetPx: visibility.rightInsetPx }
              : {})}
          >
            {composer}
          </TranscriptComposerDock>
          {visibility.secondaryChromeReady ? (
            <ComposerAccessoryRow
              variant="transcript"
              leadingControls={relocatedLeadingControls}
              branchToolbar={
                accessory.showLegacyBranchToolbar ? (
                  <BranchToolbar {...accessory.branchToolbar} className="min-w-0 flex-1" />
                ) : null
              }
            />
          ) : null}
        </div>
      ) : null}

      {visibility.shouldRenderContent && visibility.secondaryChromeReady && pullRequest ? (
        <PullRequestThreadDialog {...pullRequest} />
      ) : null}
    </>
  );
}
