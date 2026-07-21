import type { ProjectEntry, ProjectFileSystemEntry } from "@agent-group/contracts";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback } from "react";

import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { cn } from "~/lib/utils";
import { SearchInput } from "../../ui/search-input";
import { PanelStateMessage } from "../PanelStateMessage";
import type { ExplorerResultContextMenuHandler } from "./explorerActions";
import { ExplorerLoadingRows, WorkspaceSearchResultRow } from "./ExplorerRows";

const EXPLORER_SEARCH_QUERY_DEBOUNCE_MS = 120;
const EXPLORER_SEARCH_RESULTS_LIMIT = 80;
const EMPTY_WORKSPACE_SEARCH_FILE_MATCHES: ReadonlyArray<ProjectEntry> = [];

export interface WorkspaceFileSearchState {
  inputQuery: string;
  fileMatches: ReadonlyArray<ProjectEntry>;
  searchResultsPending: boolean;
  searchResultsCurrent: boolean;
  isFetching: boolean;
  error: Error | null;
  truncated: boolean;
}

export function useWorkspaceFileSearch(
  workspaceRoot: string | null,
  query: string,
): WorkspaceFileSearchState {
  const [debouncedQuery] = useDebouncedValue(query, {
    wait: EXPLORER_SEARCH_QUERY_DEBOUNCE_MS,
  });
  const inputQuery = query.trim();
  const trimmedQuery = debouncedQuery.trim();
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceRoot,
      query: trimmedQuery,
      kind: "file",
      limit: EXPLORER_SEARCH_RESULTS_LIMIT,
    }),
  );
  const searchResultsPending = inputQuery !== trimmedQuery || entriesQuery.isPlaceholderData;
  const searchResultsCurrent = !searchResultsPending;
  const fileMatches = searchResultsCurrent
    ? (entriesQuery.data?.entries ?? EMPTY_WORKSPACE_SEARCH_FILE_MATCHES)
    : EMPTY_WORKSPACE_SEARCH_FILE_MATCHES;
  return {
    inputQuery,
    fileMatches,
    searchResultsPending,
    searchResultsCurrent,
    isFetching: entriesQuery.isFetching,
    error: searchResultsCurrent ? entriesQuery.error : null,
    truncated: entriesQuery.data?.truncated ?? false,
  };
}

export function WorkspaceSearchInputHeader(props: {
  query: string;
  search: WorkspaceFileSearchState;
  autoFocus?: boolean;
  onQueryChange: (query: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const { onQueryChange, onSelectFile, query, search } = props;
  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!search.searchResultsCurrent) {
          return;
        }
        const topMatch = search.fileMatches[0];
        if (topMatch) {
          onSelectFile(topMatch.path);
        }
        return;
      }
      if (event.key === "Escape" && query.length > 0) {
        event.stopPropagation();
        onQueryChange("");
      }
    },
    [onQueryChange, onSelectFile, query.length, search.fileMatches, search.searchResultsCurrent],
  );

  return (
    <div className="shrink-0 border-b border-border/65 p-2">
      <SearchInput
        value={query}
        autoFocus={props.autoFocus}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="Search files..."
        aria-label="Search files"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleInputKeyDown}
      />
    </div>
  );
}

export function WorkspaceSearchResultsBody(props: {
  workspaceRoot: string | null;
  search: WorkspaceFileSearchState;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onPrefetchEntry: (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => void;
  onEntryContextMenu: ExplorerResultContextMenuHandler;
}) {
  const { fileMatches } = props.search;
  return (
    <>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto px-1 py-1",
          fileMatches.length === 0 && "flex flex-col",
        )}
      >
        {!props.workspaceRoot ? (
          <PanelStateMessage density="compact" fill="flex">
            <p>No workspace.</p>
          </PanelStateMessage>
        ) : props.search.searchResultsCurrent && props.search.error ? (
          <PanelStateMessage density="compact" fill="flex">
            <p className="text-destructive/85">
              {props.search.error instanceof Error
                ? props.search.error.message
                : "Could not search files."}
            </p>
          </PanelStateMessage>
        ) : fileMatches.length === 0 ? (
          props.search.searchResultsPending || props.search.isFetching ? (
            <ExplorerLoadingRows depth={0} />
          ) : (
            <PanelStateMessage density="compact" fill="flex">
              <p>No matching files.</p>
            </PanelStateMessage>
          )
        ) : (
          fileMatches.map((entry) => (
            <WorkspaceSearchResultRow
              key={entry.path}
              entry={entry}
              selected={entry.path === props.selectedFilePath}
              onSelectFile={props.onSelectFile}
              onPrefetchEntry={props.onPrefetchEntry}
              onEntryContextMenu={props.onEntryContextMenu}
            />
          ))
        )}
      </div>
      {fileMatches.length > 0 && props.search.truncated ? (
        <p className="shrink-0 border-t border-border/45 px-3 py-1.5 text-[10px] text-muted-foreground/70">
          Showing the top matches. Refine the search to narrow them down.
        </p>
      ) : null}
    </>
  );
}
