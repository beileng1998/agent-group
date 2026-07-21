import type { ProjectId } from "@agent-group/contracts";

import type { ComposerFileAttachment } from "~/composerDraftStore";

export const EMPTY_COMPOSER_FILES: ReadonlyArray<ComposerFileAttachment> = [];

export function ignoreComposerFileRemoval(_fileId: string): void {}

export interface KanbanNewTaskProjectOption {
  id: ProjectId;
  name: string;
}

export interface KanbanNewTaskDialogProps {
  onOpenChange: (open: boolean) => void;
  /** Boards available as task destinations, in board display order. */
  projectOptions: ReadonlyArray<KanbanNewTaskProjectOption>;
  initialProjectId: ProjectId | null;
  /** Seeds the "Send as draft" toggle — true when opened from the Draft column's "+". */
  initialSendAsDraft?: boolean;
}
