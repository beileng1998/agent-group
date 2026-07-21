// FILE: EmptyLandingComposerControls.tsx
// Purpose: Render project, branch, and temporary controls below the empty composer.
// Layer: Chat landing UI

import type { ComponentProps } from "react";

import BranchToolbar from "../BranchToolbar";
import { FolderClosed } from "../FolderClosed";
import { EmptyLandingControlsTray } from "./EmptyLandingControlsTray";
import { ProjectPicker } from "./ProjectPicker";

export type EmptyLandingProjectControl =
  | { kind: "workspace-picker"; props: ComponentProps<typeof ProjectPicker> }
  | { kind: "project-picker"; props: ComponentProps<typeof ProjectPicker> }
  | { kind: "label"; displayName: string }
  | null;

export interface EmptyLandingComposerControlsModel {
  project: EmptyLandingProjectControl;
  branch: {
    props: ComponentProps<typeof BranchToolbar>;
    showBranchSelector: boolean;
    temporary: boolean;
    onToggleTemporary: () => void;
  } | null;
}

function renderProjectControl(model: EmptyLandingProjectControl) {
  if (!model) return null;
  if (model.kind === "workspace-picker" || model.kind === "project-picker") {
    return <ProjectPicker {...model.props} />;
  }
  return (
    <span className="inline-flex min-w-0 max-w-56 shrink items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)] sm:max-w-64">
      <FolderClosed className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{model.displayName}</span>
    </span>
  );
}

export function EmptyLandingComposerControls({
  model,
}: {
  model: EmptyLandingComposerControlsModel | null;
}) {
  if (!model) return null;
  return (
    <EmptyLandingControlsTray
      projectControl={renderProjectControl(model.project)}
      branch={
        model.branch
          ? {
              control: (
                <BranchToolbar
                  {...model.branch.props}
                  className="mx-0 min-w-0 flex-1 !justify-start !px-0 !pb-0 !pt-0"
                  showBranchSelector={model.branch.showBranchSelector}
                />
              ),
              temporary: model.branch.temporary,
              onToggleTemporary: model.branch.onToggleTemporary,
            }
          : null
      }
    />
  );
}
