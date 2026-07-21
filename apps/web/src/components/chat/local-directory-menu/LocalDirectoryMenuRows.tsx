import type { ProjectFileSystemEntry, ProjectLocalSearchEntry } from "@agent-group/contracts";
import { memo } from "react";
import { FileIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { FolderClosed } from "../../FolderClosed";
import { CommandItem } from "../../ui/command";
import { buildSearchRowSubtitle } from "./localDirectoryPathModel";

const ROW_CLASS_NAME =
  "cursor-pointer select-none gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--color-background-elevated-secondary)]";
const HIGHLIGHTED_ROW_CLASS_NAME =
  "bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]";

export const UseCurrentFolderRow = memo(function UseCurrentFolderRow(props: {
  directoryLabel: string;
  index: number;
  isHighlighted: boolean;
  onHighlight: (index: number) => void;
  onActivate: () => void;
}) {
  const { directoryLabel, index, isHighlighted, onHighlight, onActivate } = props;
  return (
    <CommandItem
      data-highlight-index={index}
      value="use-current-folder"
      className={cn(ROW_CLASS_NAME, isHighlighted && HIGHLIGHTED_ROW_CLASS_NAME)}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseMove={() => {
        if (!isHighlighted) onHighlight(index);
      }}
      onClick={onActivate}
    >
      <FolderClosed className="size-3.5 text-muted-foreground/60" />
      <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
        <span className="shrink-0 text-[11.5px] font-medium text-foreground/80">
          Use this folder
        </span>
        <span className="truncate text-[11px] text-muted-foreground/55">{directoryLabel}</span>
      </div>
    </CommandItem>
  );
});

export const LocalSearchRow = memo(function LocalSearchRow(props: {
  entry: ProjectLocalSearchEntry;
  rootPath: string;
  index: number;
  isHighlighted: boolean;
  onActivate: (entry: ProjectLocalSearchEntry) => void;
  onHighlight: (index: number) => void;
}) {
  const { entry, rootPath, index, isHighlighted, onActivate, onHighlight } = props;
  const isDirectory = entry.kind === "directory";
  const subtitle = buildSearchRowSubtitle(entry, rootPath);

  return (
    <CommandItem
      data-highlight-index={index}
      value={`search:${entry.kind}:${entry.path}`}
      className={cn(ROW_CLASS_NAME, isHighlighted && HIGHLIGHTED_ROW_CLASS_NAME)}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseMove={() => {
        if (!isHighlighted) onHighlight(index);
      }}
      onClick={() => onActivate(entry)}
    >
      {isDirectory ? (
        <FolderClosed className="size-3.5 text-muted-foreground/60" />
      ) : (
        <FileIcon className="size-3.5 text-muted-foreground/60" />
      )}
      <div className="min-w-0 flex flex-1 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-foreground/80">
          {entry.name}
        </span>
        {subtitle ? (
          <span className="shrink-0 max-w-[60%] truncate pl-2 text-right text-[10.5px] text-muted-foreground/42">
            {subtitle}
          </span>
        ) : null}
      </div>
    </CommandItem>
  );
});

export const LocalEntryRow = memo(function LocalEntryRow(props: {
  entry: ProjectFileSystemEntry;
  index: number;
  isHighlighted: boolean;
  onActivate: (entry: ProjectFileSystemEntry) => void;
  onHighlight: (index: number) => void;
}) {
  const { entry, index, isHighlighted, onActivate, onHighlight } = props;
  const isDirectory = entry.kind === "directory";

  return (
    <CommandItem
      data-highlight-index={index}
      value={`${entry.kind}:${entry.path}`}
      className={cn(ROW_CLASS_NAME, isHighlighted && HIGHLIGHTED_ROW_CLASS_NAME)}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseMove={() => {
        if (!isHighlighted) onHighlight(index);
      }}
      onClick={() => onActivate(entry)}
    >
      {isDirectory ? (
        <FolderClosed className="size-3.5 text-muted-foreground/60" />
      ) : (
        <FileIcon className="size-3.5 text-muted-foreground/60" />
      )}
      <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
        <span className="truncate text-[11.5px] font-medium text-foreground/80">{entry.name}</span>
      </div>
    </CommandItem>
  );
});
