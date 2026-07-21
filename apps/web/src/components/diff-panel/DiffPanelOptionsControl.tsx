import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { TurnId } from "@agent-group/contracts";
import { useState } from "react";
import type { TimestampFormat } from "../../appSettings";
import { Columns2Icon, CopyIcon, EllipsisIcon, FolderIcon, Rows3Icon } from "../../lib/icons";
import { REPO_DIFF_SCOPE_LABELS, type RepoDiffScope } from "../../repoDiffScopeStore";
import { formatShortTimestamp } from "../../timestampFormat";
import type { TurnDiffSummary } from "../../types";
import type { DiffRenderMode } from "../chat/chatHeaderControls";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { DIFF_PANEL_PICKER_SCOPE_OPTIONS } from "../DiffPanel.logic";
import { IconButton } from "../ui/icon-button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";

const MENU_ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground";

export interface DiffPanelOptionsModel {
  source: {
    scopePickerValue: string | null;
    scopeFileCounts: Partial<Record<RepoDiffScope, number>>;
    selectedTurnId: TurnId | null;
    orderedTurnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
    inferredCheckpointTurnCountByTurnId: Record<string, number>;
    timestampFormat: TimestampFormat;
  };
  view: {
    diffRenderMode: DiffRenderMode;
    diffWordWrap: boolean;
    diffIgnoreWhitespace: boolean;
    diffCopyText: string | null;
    isDiffCopied: boolean;
  };
  files: {
    renderableFiles: ReadonlyArray<FileDiffMetadata>;
    allFilesCollapsed: boolean;
  };
  actions: {
    selectRepoScope(scope: RepoDiffScope): void;
    selectAllTurns(): void;
    selectLastTurn(): void;
    selectTurn(turnId: TurnId | null): void;
    setDiffRenderMode(mode: DiffRenderMode): void;
    setDiffWordWrap(enabled: boolean): void;
    setDiffIgnoreWhitespace(enabled: boolean): void;
    copyDiff(): void;
    toggleCollapseAll(): void;
  };
}

function CountBadge({ count }: { count: number | undefined }) {
  if (typeof count !== "number" || count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
      {count}
    </span>
  );
}

export function DiffPanelOptionsControl({ model }: { model: DiffPanelOptionsModel }) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { source, view, files, actions } = model;

  return (
    <div className="flex items-center gap-1">
      <Menu open={optionsOpen} onOpenChange={setOptionsOpen}>
        <MenuTrigger
          render={
            <IconButton
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              label="Diff options"
              title="Diff options"
              onClick={() => setOptionsOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setOptionsOpen(true);
              }}
              onPointerDown={() => setOptionsOpen(true)}
            >
              <EllipsisIcon className="size-3.5" />
            </IconButton>
          }
        />
        <ComposerPickerMenuPopup align="end" side="bottom" sideOffset={6} className="w-64 min-w-64">
          <MenuGroup>
            <MenuGroupLabel>Source</MenuGroupLabel>
            <MenuRadioGroup
              value={source.scopePickerValue ?? ""}
              onValueChange={(value) => {
                if (value === "allTurns") return actions.selectAllTurns();
                if (value === "lastTurn") return actions.selectLastTurn();
                if (
                  value === "workingTree" ||
                  value === "unstaged" ||
                  value === "staged" ||
                  value === "branch"
                ) {
                  actions.selectRepoScope(value);
                }
              }}
            >
              {DIFF_PANEL_PICKER_SCOPE_OPTIONS.map((scope) => (
                <MenuRadioItem key={scope} value={scope}>
                  <span className="min-w-0 flex-1 truncate">{REPO_DIFF_SCOPE_LABELS[scope]}</span>
                  <CountBadge count={source.scopeFileCounts[scope]} />
                </MenuRadioItem>
              ))}
              <MenuRadioItem value="allTurns">
                <span className="min-w-0 flex-1 truncate">All turns</span>
              </MenuRadioItem>
              <MenuRadioItem value="lastTurn">
                <span className="min-w-0 flex-1 truncate">Last turn</span>
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>

          {source.orderedTurnDiffSummaries.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>Turns</MenuGroupLabel>
              <MenuRadioGroup
                value={source.selectedTurnId ?? "all-turns"}
                onValueChange={(value) =>
                  actions.selectTurn(value === "all-turns" ? null : (value as TurnId))
                }
              >
                <MenuRadioItem value="all-turns">
                  <span className="min-w-0 flex-1 truncate">All turns</span>
                </MenuRadioItem>
                {source.orderedTurnDiffSummaries.map((summary) => {
                  const turnNumber =
                    summary.checkpointTurnCount ??
                    source.inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?";
                  return (
                    <MenuRadioItem key={summary.turnId} value={summary.turnId}>
                      <span className="min-w-0 flex-1 truncate">Turn {turnNumber}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {formatShortTimestamp(summary.completedAt, source.timestampFormat)}
                      </span>
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioGroup>
            </MenuGroup>
          ) : null}

          <MenuGroup>
            <MenuGroupLabel>View</MenuGroupLabel>
            <MenuRadioGroup
              value={view.diffRenderMode}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") actions.setDiffRenderMode(value);
              }}
            >
              <MenuRadioItem value="stacked">
                <Rows3Icon className={MENU_ICON_CLASS_NAME} />
                <span>Stacked diff</span>
              </MenuRadioItem>
              <MenuRadioItem value="split">
                <Columns2Icon className={MENU_ICON_CLASS_NAME} />
                <span>Split diff</span>
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuCheckboxItem
              checked={view.diffIgnoreWhitespace}
              variant="switch"
              onCheckedChange={(checked) => actions.setDiffIgnoreWhitespace(checked === true)}
            >
              Ignore whitespace-only changes
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={view.diffWordWrap}
              variant="switch"
              onCheckedChange={(checked) => actions.setDiffWordWrap(checked === true)}
            >
              Wrap long lines
            </MenuCheckboxItem>
            {view.diffCopyText ? (
              <MenuItem onClick={actions.copyDiff}>
                <CopyIcon className={MENU_ICON_CLASS_NAME} />
                <span>{view.isDiffCopied ? "Copied diff" : "Copy diff"}</span>
              </MenuItem>
            ) : null}
            {files.renderableFiles.length > 0 ? (
              <MenuItem onClick={actions.toggleCollapseAll}>
                <FolderIcon className={MENU_ICON_CLASS_NAME} />
                <span>{files.allFilesCollapsed ? "Expand all files" : "Collapse all files"}</span>
              </MenuItem>
            ) : null}
          </MenuGroup>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}
