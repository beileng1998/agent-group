// FILE: PullRequestDetailPanel.tsx
// Purpose: Composition root for the pull request detail surface.
// Layer: Pull request presentation
// Exports: PullRequestDetailPanel

import type { PullRequestDetailInput } from "@agent-group/contracts";

import { PullRequestConfirmDialog } from "./detail-panel/PullRequestConfirmDialog";
import { PullRequestDetailHeader } from "./detail-panel/PullRequestDetailHeader";
import { PullRequestDetailView } from "./detail-panel/PullRequestDetailView";
import {
  type PullRequestDetailTab,
  usePullRequestDetailController,
} from "./detail-panel/usePullRequestDetailController";

export function PullRequestDetailPanel({
  input,
  initialTab = "summary",
  onClose,
  pollingEnabled = true,
}: {
  input: PullRequestDetailInput;
  initialTab?: PullRequestDetailTab;
  onClose?: () => void;
  pollingEnabled?: boolean;
}) {
  const controller = usePullRequestDetailController({ input, initialTab, pollingEnabled });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--color-background-surface)] text-foreground">
      <PullRequestDetailHeader controller={controller} onClose={onClose} />
      <PullRequestDetailView controller={controller} />
      <PullRequestConfirmDialog controller={controller} />
    </div>
  );
}

export default PullRequestDetailPanel;
