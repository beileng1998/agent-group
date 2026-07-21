import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";

import type { ChatFileReference } from "~/lib/chatReferences";
import {
  buildFileDiffRenderKey,
  resolveFileDiffPath,
  splitRepoRelativePath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import { ChangesIcon, DiffIcon, FoldersIcon, SearchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";

import { DiffStat } from "../chat/DiffStatLabel";
import { EXPLORER_ROW_PROPS, useExplorerListNavigation } from "../chat/explorerListNavigation";
import { FileEntryIcon } from "../chat/FileEntryIcon";
import { fileRowClassName } from "../chat/fileRowStyles";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import {
  ExplorerActivityBarButton,
  setFileReferenceDragData,
  WorkspaceFilesSidebar,
  WorkspaceSearchSidebar,
} from "../chat/workspaceExplorer";
import { Skeleton } from "../ui/skeleton";
import type { EditorActivityBarItem, EditorCenterMode } from "./editorWorkspaceTypes";

function DiffFileRow(props: {
  fileDiff: FileDiffMetadata;
  selected: boolean;
  resolvedTheme: "light" | "dark";
  onSelectFile: (path: string) => void;
  onFileContextMenu: (filePath: string, position: { x: number; y: number }) => void;
}) {
  const filePath = resolveFileDiffPath(props.fileDiff);
  const { dir, name } = splitRepoRelativePath(filePath);
  const stat = useMemo(() => summarizeFileDiffStats([props.fileDiff]), [props.fileDiff]);

  return (
    <button
      {...EXPLORER_ROW_PROPS}
      type="button"
      className={fileRowClassName(props.selected, "h-8 px-2")}
      title={filePath}
      draggable
      onDragStart={(event) => setFileReferenceDragData(event.dataTransfer, filePath)}
      onClick={() => props.onSelectFile(filePath)}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onFileContextMenu(filePath, { x: event.clientX, y: event.clientY });
      }}
    >
      <FileEntryIcon
        pathValue={filePath}
        kind="file"
        theme={props.resolvedTheme}
        className="size-3.5 shrink-0"
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 truncate font-medium">{name}</span>
          {dir ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground/55">{dir}</span>
          ) : null}
        </div>
      </div>
      <DiffStat
        additions={stat.additions}
        deletions={stat.deletions}
        className="shrink-0 text-[10px] tabular-nums"
      />
    </button>
  );
}

const DIFF_FILE_SKELETON_ROW_WIDTHS = ["w-10/12", "w-7/12", "w-9/12", "w-6/12", "w-8/12"];

function DiffFilesLoadingRows() {
  return (
    <div className="space-y-1 px-1 py-1" role="status" aria-label="Loading changed files...">
      {DIFF_FILE_SKELETON_ROW_WIDTHS.map((width) => (
        <div key={width} className="flex h-8 items-center gap-1.5 px-2">
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3 rounded-full", width)} />
          <Skeleton className="ml-auto h-3 w-9 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function DiffFilesSidebar(props: {
  files: ReadonlyArray<FileDiffMetadata>;
  isLoading: boolean;
  selectedFilePath: string | null;
  optionsControl?: ReactNode;
  onSelectFile: (path: string) => void;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat: ((reference: ChatFileReference) => void) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const { onAskWhyInChat, onReferenceInChat } = props;
  const handleListKeyDown = useExplorerListNavigation();
  const totals = useMemo(() => summarizeFileDiffStats(props.files), [props.files]);
  const hasDiffStats = totals.additions > 0 || totals.deletions > 0;
  const showLoadingRows = props.isLoading && props.files.length === 0;
  const handleFileContextMenu = useCallback(
    (filePath: string, position: { x: number; y: number }) => {
      void showFileReferenceContextMenu({
        path: filePath,
        position,
        onReferenceInChat,
        onAskWhyInChat,
      });
    },
    [onAskWhyInChat, onReferenceInChat],
  );

  return (
    <aside className="flex min-h-[11rem] w-full shrink-0 flex-col border-b border-border/65 bg-[var(--color-background-surface)] lg:h-full lg:w-56 lg:border-b-0 lg:border-r">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/65 px-3">
        <DiffIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/86">
          Changed files
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {props.files.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {props.files.length}
            </span>
          ) : null}
          {props.optionsControl}
        </div>
      </div>
      {hasDiffStats ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/45 px-3">
          <DiffStat
            additions={totals.additions}
            deletions={totals.deletions}
            className="text-[11px] tabular-nums"
          />
        </div>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto px-1 py-1",
          !showLoadingRows && props.files.length === 0 && "flex flex-col",
        )}
        onKeyDown={handleListKeyDown}
      >
        {showLoadingRows ? (
          <DiffFilesLoadingRows />
        ) : props.files.length === 0 ? (
          <PanelStateMessage density="compact" fill="flex">
            <p>No files in this diff.</p>
          </PanelStateMessage>
        ) : (
          props.files.map((fileDiff) => {
            const filePath = resolveFileDiffPath(fileDiff);
            return (
              <DiffFileRow
                key={buildFileDiffRenderKey(fileDiff)}
                fileDiff={fileDiff}
                resolvedTheme={resolvedTheme}
                selected={props.selectedFilePath === filePath}
                onSelectFile={props.onSelectFile}
                onFileContextMenu={handleFileContextMenu}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

export function EditorActivityBar(props: {
  centerMode: EditorCenterMode;
  searchActive: boolean;
  sidebarVisible: boolean;
  onSelectItem: (item: EditorActivityBarItem) => void;
}) {
  const filesActive = props.sidebarVisible && !props.searchActive && props.centerMode === "file";
  const diffActive = props.sidebarVisible && !props.searchActive && props.centerMode === "diff";
  const searchActive = props.sidebarVisible && props.searchActive;
  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center border-r border-border/65 bg-[var(--color-background-surface)]"
      aria-label="Editor activity bar"
    >
      <ExplorerActivityBarButton
        label={filesActive ? "Hide files sidebar" : "Files"}
        active={filesActive}
        onClick={() => props.onSelectItem("file")}
      >
        <FoldersIcon className="size-5" />
      </ExplorerActivityBarButton>
      <ExplorerActivityBarButton
        label={diffActive ? "Hide diff sidebar" : "Diff"}
        active={diffActive}
        onClick={() => props.onSelectItem("diff")}
      >
        <ChangesIcon className="size-5" />
      </ExplorerActivityBarButton>
      <ExplorerActivityBarButton
        label={searchActive ? "Hide search sidebar" : "Search files"}
        active={searchActive}
        onClick={() => props.onSelectItem("search")}
      >
        <SearchIcon className="size-5" />
      </ExplorerActivityBarButton>
    </nav>
  );
}

export function EditorWorkspaceSidebar(props: {
  visible: boolean;
  searchActive: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  centerMode: EditorCenterMode;
  diffFiles: ReadonlyArray<FileDiffMetadata>;
  diffFilesLoading: boolean;
  selectedDiffFilePath: string | null;
  diffOptionsControl?: ReactNode;
  onSelectFile: (path: string) => void;
  onSelectDiffFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat: ((reference: ChatFileReference) => void) | undefined;
}) {
  if (!props.visible) {
    return null;
  }
  if (props.searchActive) {
    return (
      <WorkspaceSearchSidebar
        workspaceRoot={props.workspaceRoot}
        query={props.searchQuery}
        onQueryChange={props.onSearchQueryChange}
        selectedFilePath={props.selectedFilePath}
        onSelectFile={props.onSelectFile}
        onReferenceInChat={props.onReferenceInChat}
      />
    );
  }
  if (props.centerMode === "diff") {
    return (
      <DiffFilesSidebar
        files={props.diffFiles}
        isLoading={props.diffFilesLoading}
        selectedFilePath={props.selectedDiffFilePath}
        optionsControl={props.diffOptionsControl}
        onSelectFile={props.onSelectDiffFile}
        onReferenceInChat={props.onReferenceInChat}
        onAskWhyInChat={props.onAskWhyInChat}
      />
    );
  }
  return (
    <WorkspaceFilesSidebar
      workspaceRoot={props.workspaceRoot}
      selectedFilePath={props.selectedFilePath}
      expandedDirectories={props.expandedDirectories}
      onSelectFile={props.onSelectFile}
      onToggleDirectory={props.onToggleDirectory}
      onReferenceInChat={props.onReferenceInChat}
    />
  );
}
