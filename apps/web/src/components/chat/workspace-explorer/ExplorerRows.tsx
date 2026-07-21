import type { ProjectEntry, ProjectFileSystemEntry } from "@agent-group/contracts";
import {
  type ComponentPropsWithoutRef,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  forwardRef,
  useCallback,
} from "react";

import { splitRepoRelativePath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { DisclosureChevron } from "../../ui/DisclosureChevron";
import { Skeleton } from "../../ui/skeleton";
import { EXPLORER_ROW_PROPS } from "../explorerListNavigation";
import { FileEntryIcon } from "../FileEntryIcon";
import { fileRowClassName, fileRowIndentStyle } from "../fileRowStyles";
import {
  type ExplorerEntryContextMenuHandler,
  type ExplorerResultContextMenuHandler,
  setFileReferenceDragData,
} from "./explorerActions";

interface ExplorerRowProps {
  entry: ProjectFileSystemEntry;
  depth: number;
  selected: boolean;
  expanded: boolean;
  onSelectFile: (path: string) => void;
  onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
  onEntryContextMenu: ExplorerEntryContextMenuHandler;
}

// Forwards its ref and spreads incoming props so directory rows can act as the
// Collapsible trigger (Base UI injects onClick/aria/data + ref onto this element).
export const ExplorerRow = forwardRef<
  HTMLButtonElement,
  ExplorerRowProps & ComponentPropsWithoutRef<"button">
>(function ExplorerRow(
  {
    entry,
    depth,
    selected,
    expanded,
    onSelectFile,
    onPrefetchEntry,
    onEntryContextMenu,
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const isDirectory = entry.kind === "directory";
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (isDirectory) {
        return;
      }
      onSelectFile(entry.path);
    },
    [entry.path, isDirectory, onClick, onSelectFile],
  );
  const handlePrefetch = useCallback(() => {
    onPrefetchEntry(entry);
  }, [entry, onPrefetchEntry]);
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onEntryContextMenu(entry, { x: event.clientX, y: event.clientY });
    },
    [entry, onEntryContextMenu],
  );
  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>) => {
      setFileReferenceDragData(event.dataTransfer, entry.path);
    },
    [entry.path],
  );

  return (
    <button
      {...rest}
      {...EXPLORER_ROW_PROPS}
      ref={ref}
      type="button"
      className={fileRowClassName(selected, cn("h-7 pr-2", className))}
      style={fileRowIndentStyle(depth)}
      title={entry.path}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onPointerEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onContextMenu={handleContextMenu}
    >
      {isDirectory ? (
        <DisclosureChevron open={expanded} className="opacity-75" />
      ) : (
        <FileEntryIcon
          pathValue={entry.path}
          kind={entry.kind}
          className="size-3.5 shrink-0 opacity-75"
        />
      )}
      <span className="min-w-0 truncate">{entry.name}</span>
    </button>
  );
});

const EXPLORER_SKELETON_ROW_WIDTHS = ["w-9/12", "w-6/12", "w-7/12"];

export function ExplorerLoadingRows(props: { depth: number }) {
  return (
    <div
      className="space-y-1.5 py-1.5 pr-2"
      style={fileRowIndentStyle(props.depth)}
      role="status"
      aria-label="Loading directory..."
    >
      {EXPLORER_SKELETON_ROW_WIDTHS.map((width) => (
        <div key={width} className="flex h-5 items-center gap-1.5">
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3 rounded-full", width)} />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceSearchResultRow(props: {
  entry: ProjectEntry;
  selected: boolean;
  onSelectFile: (path: string) => void;
  onPrefetchEntry: (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => void;
  onEntryContextMenu: ExplorerResultContextMenuHandler;
}) {
  const { entry, onEntryContextMenu, onPrefetchEntry, onSelectFile } = props;
  const { dir, name } = splitRepoRelativePath(entry.path);
  const handlePrefetch = useCallback(() => {
    onPrefetchEntry(entry);
  }, [entry, onPrefetchEntry]);

  return (
    <button
      {...EXPLORER_ROW_PROPS}
      type="button"
      className={fileRowClassName(props.selected, "h-8 px-2")}
      title={entry.path}
      draggable
      onDragStart={(event) => {
        setFileReferenceDragData(event.dataTransfer, entry.path);
      }}
      onClick={() => onSelectFile(entry.path)}
      onPointerEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onContextMenu={(event) => {
        event.preventDefault();
        onEntryContextMenu(entry.path, { x: event.clientX, y: event.clientY });
      }}
    >
      <FileEntryIcon pathValue={entry.path} kind="file" className="size-3.5 shrink-0 opacity-75" />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 truncate font-medium">{name}</span>
        {dir ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/55">{dir}</span>
        ) : null}
      </div>
    </button>
  );
}
