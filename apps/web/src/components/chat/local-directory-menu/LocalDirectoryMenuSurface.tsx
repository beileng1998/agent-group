import { ArrowUpIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { FolderClosed } from "../../FolderClosed";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandList,
  CommandSeparator,
} from "../../ui/command";
import {
  COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME,
  COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME,
} from "../composerPickerStyles";
import { isRootDirectory } from "./localDirectoryPathModel";
import { LocalEntryRow, LocalSearchRow, UseCurrentFolderRow } from "./LocalDirectoryMenuRows";
import type { LocalDirectoryMenuController } from "./useLocalDirectoryMenuController";

export function LocalDirectoryMenuSurface(props: { controller: LocalDirectoryMenuController }) {
  const {
    currentFolderRow,
    directory,
    entryRowStartIndex,
    errorMessage,
    expandedDirectory,
    files,
    filter,
    folders,
    handleActivateEntry,
    handleActivateSearchEntry,
    handleGoUp,
    handleSelectCurrentDirectory,
    headerLabel,
    highlightedIndex,
    isAwaitingHomeDir,
    isLoading,
    isSearchPending,
    isSearchTruncated,
    listRef,
    parent,
    searchRows,
    searchRowStartIndex,
    setHighlightedIndex,
    visibleCount,
  } = props.controller;

  return (
    <Command autoHighlight={false} mode="none">
      <div className={COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME}>
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          {parent ? (
            <button
              type="button"
              aria-label="Go up one directory"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleGoUp}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          ) : (
            <FolderClosed className="size-3.5 shrink-0 text-muted-foreground/70" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/80">
            {headerLabel}
          </span>
          {!isRootDirectory(directory) ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleSelectCurrentDirectory}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground"
            >
              Use this folder
            </button>
          ) : null}
        </div>
        <div
          ref={listRef}
          className={cn(COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME, "max-h-72")}
          data-slot="menu-popup-body"
        >
          <CommandList className="py-0.5">
            {currentFolderRow ? (
              <CommandGroup>
                <UseCurrentFolderRow
                  directoryLabel={headerLabel}
                  index={0}
                  isHighlighted={highlightedIndex === 0}
                  onHighlight={setHighlightedIndex}
                  onActivate={handleSelectCurrentDirectory}
                />
              </CommandGroup>
            ) : null}
            {currentFolderRow && (folders.length > 0 || files.length > 0) ? (
              <CommandSeparator className="my-0.5" />
            ) : null}
            {folders.length > 0 ? (
              <CommandGroup>
                {folders.map((entry, folderIndex) => {
                  const absoluteIndex = entryRowStartIndex + folderIndex;
                  return (
                    <LocalEntryRow
                      key={`dir:${entry.path}`}
                      entry={entry}
                      index={absoluteIndex}
                      isHighlighted={highlightedIndex === absoluteIndex}
                      onActivate={handleActivateEntry}
                      onHighlight={setHighlightedIndex}
                    />
                  );
                })}
              </CommandGroup>
            ) : null}
            {folders.length > 0 && files.length > 0 ? (
              <CommandSeparator className="my-0.5" />
            ) : null}
            {files.length > 0 ? (
              <CommandGroup>
                {files.map((entry, fileIndex) => {
                  const absoluteIndex = entryRowStartIndex + folders.length + fileIndex;
                  return (
                    <LocalEntryRow
                      key={`file:${entry.path}`}
                      entry={entry}
                      index={absoluteIndex}
                      isHighlighted={highlightedIndex === absoluteIndex}
                      onActivate={handleActivateEntry}
                      onHighlight={setHighlightedIndex}
                    />
                  );
                })}
              </CommandGroup>
            ) : null}
            {searchRows.length > 0 ? (
              <>
                {folders.length > 0 || files.length > 0 ? (
                  <CommandSeparator className="my-0.5" />
                ) : null}
                <CommandGroup>
                  <CommandGroupLabel className="px-2 pt-1.5 pb-1 text-[10px] font-semibold text-muted-foreground/55">
                    Matches deeper
                  </CommandGroupLabel>
                  {searchRows.map((entry, searchIndex) => {
                    const absoluteIndex = searchRowStartIndex + searchIndex;
                    return (
                      <LocalSearchRow
                        key={`search:${entry.kind}:${entry.path}`}
                        entry={entry}
                        rootPath={expandedDirectory}
                        index={absoluteIndex}
                        isHighlighted={highlightedIndex === absoluteIndex}
                        onActivate={handleActivateSearchEntry}
                        onHighlight={setHighlightedIndex}
                      />
                    );
                  })}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </div>
        {isAwaitingHomeDir ? (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">
            Waiting for home directory from server…
          </p>
        ) : isLoading && visibleCount === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">Loading local files…</p>
        ) : errorMessage ? (
          <p className="px-2 py-1.5 text-destructive/80 text-[11px]">{errorMessage}</p>
        ) : isSearchPending ? (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">
            Searching nested files…
          </p>
        ) : visibleCount === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">
            {filter.trim().length > 0 ? "No matches." : "No files or folders here."}
          </p>
        ) : isSearchTruncated ? (
          <p className="px-2 py-1 text-muted-foreground/40 text-[10.5px]">
            Showing top matches. Keep typing to narrow.
          </p>
        ) : null}
      </div>
    </Command>
  );
}
