import type { ComponentProps } from "react";

import { AutomationDialog } from "../../routes/-automations.shared";
import { RenameThreadDialog } from "../RenameThreadDialog";
import { ThreadWorktreeHandoffDialog } from "../ThreadWorktreeHandoffDialog";
import { ComposerSlashStatusDialog } from "./ComposerSlashStatusDialog";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import { ThreadMarkerEditPopover } from "./ThreadMarkerEditPopover";
import { TranscriptSelectionActionLayer } from "./TranscriptSelectionActionLayer";

export interface ChatDialogLayerModel {
  rename: ComponentProps<typeof RenameThreadDialog>;
  automation: ComponentProps<typeof AutomationDialog> | null;
}

export interface ChatOverlayLayerModel {
  slashStatus: ComponentProps<typeof ComposerSlashStatusDialog>;
  worktreeHandoff: ComponentProps<typeof ThreadWorktreeHandoffDialog> | null;
  selection: ComponentProps<typeof TranscriptSelectionActionLayer> | null;
  marker: ComponentProps<typeof ThreadMarkerEditPopover> | null;
  image: ComponentProps<typeof ExpandedImageDialog> | null;
}

export function ChatDialogLayer({ model }: { model: ChatDialogLayerModel }) {
  return (
    <>
      <RenameThreadDialog {...model.rename} />
      {model.automation ? <AutomationDialog {...model.automation} /> : null}
    </>
  );
}

export function ChatOverlayLayer({ model }: { model: ChatOverlayLayerModel }) {
  return (
    <>
      <ComposerSlashStatusDialog {...model.slashStatus} />
      {model.worktreeHandoff ? <ThreadWorktreeHandoffDialog {...model.worktreeHandoff} /> : null}
      {model.selection ? <TranscriptSelectionActionLayer {...model.selection} /> : null}
      {model.marker ? <ThreadMarkerEditPopover {...model.marker} /> : null}
      {model.image ? <ExpandedImageDialog {...model.image} /> : null}
    </>
  );
}
