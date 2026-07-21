import type { GitStatusResult } from "@agent-group/contracts";

import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { MenuGroup, MenuGroupLabel, MenuSeparator } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { GitPickerMenuRow } from "./GitActionPresentation";
import type { GitPickerMenuItem } from "./gitActionsTypes";

export interface GitActionMenuContentProps {
  items: readonly GitPickerMenuItem[];
  gitStatus: GitStatusResult | null;
  isGitStatusOutOfSync: boolean;
  gitStatusError: Error | null;
  align: "start" | "end";
  className: string;
}

export function GitActionMenuContent({
  items,
  gitStatus,
  isGitStatusOutOfSync,
  gitStatusError,
  align,
  className,
}: GitActionMenuContentProps) {
  return (
    <ComposerPickerMenuPopup align={align} side="bottom" className={className}>
      <MenuGroup>
        <MenuGroupLabel>Git actions</MenuGroupLabel>
        {items.map((item) => {
          const menuRow = <GitPickerMenuRow item={item} />;
          if (item.disabled && item.disabledReason) {
            return (
              <Popover key={item.id}>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  render={<span className="block cursor-not-allowed" />}
                >
                  {menuRow}
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="left" align="center">
                  {item.disabledReason}
                </PopoverPopup>
              </Popover>
            );
          }
          return <GitPickerMenuRow key={item.id} item={item} />;
        })}
      </MenuGroup>
      {(gitStatus?.branch === null ||
        (gitStatus &&
          gitStatus.branch !== null &&
          !gitStatus.hasWorkingTreeChanges &&
          gitStatus.behindCount > 0 &&
          gitStatus.aheadCount === 0) ||
        isGitStatusOutOfSync ||
        gitStatusError) && <MenuSeparator className="mx-3 mt-2" />}
      {gitStatus?.branch === null && (
        <p className="px-3 py-1.5 text-xs text-warning">
          Detached HEAD: create and checkout a branch to enable push and PR actions.
        </p>
      )}
      {gitStatus &&
        gitStatus.branch !== null &&
        !gitStatus.hasWorkingTreeChanges &&
        gitStatus.behindCount > 0 &&
        gitStatus.aheadCount === 0 && (
          <p className="px-3 py-1.5 text-xs text-warning">Behind upstream. Pull/rebase first.</p>
        )}
      {isGitStatusOutOfSync && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">Refreshing git status...</p>
      )}
      {gitStatusError && (
        <p className="px-3 py-1.5 text-xs text-destructive">{gitStatusError.message}</p>
      )}
    </ComposerPickerMenuPopup>
  );
}
