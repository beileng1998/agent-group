// Purpose: Branch/worktree picker for the chat toolbar.
// Coordinates branch checkout/create actions and decorates rows with git metadata.

import { BranchSelectorSurface } from "./branch-selector/BranchSelectorSurface";
import type { BranchToolbarBranchSelectorProps } from "./branch-selector/branchSelectorTypes";
import { useBranchSelectorController } from "./branch-selector/useBranchSelectorController";

export type { BranchSelectorVariant } from "./branch-selector/branchSelectorTypes";

export function BranchToolbarBranchSelector(props: BranchToolbarBranchSelectorProps) {
  const controller = useBranchSelectorController(props);
  return <BranchSelectorSurface controller={controller} props={props} />;
}
