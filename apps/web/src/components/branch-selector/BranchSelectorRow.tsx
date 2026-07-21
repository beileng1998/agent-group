import { pluralize } from "@agent-group/shared/text";
import type { CSSProperties } from "react";

import { ComboboxItem } from "../ui/combobox";
import type { BranchToolbarBranchSelectorProps } from "./branchSelectorTypes";
import { getCurrentBranchChangeSummary } from "./branchSelectorValues";
import type { BranchSelectorController } from "./useBranchSelectorController";

interface BranchSelectorRowProps {
  activeProjectCwd: string;
  controller: BranchSelectorController;
  index: number;
  itemValue: string;
  onCheckoutPullRequestRequest: BranchToolbarBranchSelectorProps["onCheckoutPullRequestRequest"];
  onComposerFocusRequest: BranchToolbarBranchSelectorProps["onComposerFocusRequest"];
  style?: CSSProperties;
}

export function BranchSelectorRow({
  activeProjectCwd,
  controller,
  index,
  itemValue,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  style,
}: BranchSelectorRowProps) {
  const { readModel } = controller;
  if (
    readModel.checkoutPullRequestItemValue &&
    itemValue === readModel.checkoutPullRequestItemValue
  ) {
    return (
      <ComboboxItem
        hideIndicator
        index={index}
        value={itemValue}
        style={style}
        onClick={() => {
          if (!readModel.prReference || !onCheckoutPullRequestRequest) return;
          controller.handleOpenChange(false);
          onComposerFocusRequest?.();
          onCheckoutPullRequestRequest(readModel.prReference);
        }}
      >
        <div className="flex min-w-0 flex-col items-start py-1">
          <span className="truncate font-medium">Checkout Pull Request</span>
          <span className="truncate text-muted-foreground text-xs">{readModel.prReference}</span>
        </div>
      </ComboboxItem>
    );
  }

  const branch = readModel.branchByName.get(itemValue);
  if (!branch) return null;
  const hasSecondaryWorktree = branch.worktreePath && branch.worktreePath !== activeProjectCwd;
  const currentBranchChangeSummary = getCurrentBranchChangeSummary(
    branch,
    readModel.branchStatusQuery.data,
  );
  const badge = branch.current
    ? "current"
    : hasSecondaryWorktree
      ? "worktree"
      : branch.isRemote
        ? "remote"
        : branch.isDefault
          ? "default"
          : null;

  return (
    <ComboboxItem
      hideIndicator
      index={index}
      value={itemValue}
      className={
        itemValue === controller.resolvedActiveBranch
          ? "bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]"
          : undefined
      }
      style={style}
      onClick={() => controller.selectBranch(branch)}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{itemValue}</span>
            {badge && (
              <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>
            )}
          </div>
          {currentBranchChangeSummary ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
              <span className="text-muted-foreground">
                Uncommitted: {currentBranchChangeSummary.fileCount.toLocaleString()}{" "}
                {pluralize(currentBranchChangeSummary.fileCount, "file")}
              </span>
              <span className="font-mono tabular-nums text-success">
                +{currentBranchChangeSummary.insertions.toLocaleString()}
              </span>
              <span className="font-mono tabular-nums text-destructive">
                -{currentBranchChangeSummary.deletions.toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </ComboboxItem>
  );
}
