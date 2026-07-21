import type { ProjectFileSystemEntry, ProjectLocalSearchEntry } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { expandLocalFolderPath } from "~/lib/localFolderMentions";
import { projectSearchLocalEntriesQueryOptions } from "~/lib/projectReactQuery";
import { readNativeApi } from "~/nativeApi";
import {
  basename,
  deriveDirectoryAndFilter,
  detectPathSeparator,
  filterLocalEntries,
  isRootDirectory,
  joinDirectoryPath,
  parentDirectory,
  summarizeDirectoryLoadError,
} from "./localDirectoryPathModel";
import type {
  ComposerLocalDirectoryMenuProps,
  EntriesByPath,
  VisibleLocalDirectoryRow,
} from "./localDirectoryTypes";

const LOCAL_SEARCH_DEBOUNCE_MS = 220;
const LOCAL_SEARCH_MIN_QUERY_LENGTH = 2;

export function useLocalDirectoryMenuController(props: ComposerLocalDirectoryMenuProps) {
  const { mentionQuery, rootLabel, homeDir, onSelectEntry, onNavigateFolder, handleRef } = props;
  const [entriesByPath, setEntriesByPath] = useState<EntriesByPath>({});
  const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const { directory, filter } = useMemo(
    () => deriveDirectoryAndFilter(mentionQuery),
    [mentionQuery],
  );
  const expandedDirectory = useMemo(
    () => expandLocalFolderPath(directory, homeDir),
    [directory, homeDir],
  );
  const isAwaitingHomeDir = useMemo(
    () =>
      (directory === "~" || directory.startsWith("~/") || directory.startsWith("~\\")) &&
      (!homeDir || homeDir.trim().length === 0),
    [directory, homeDir],
  );

  useEffect(() => {
    setErrorMessage(null);
  }, [expandedDirectory]);

  useEffect(() => {
    if (!expandedDirectory || isAwaitingHomeDir) return;
    if (entriesByPath[expandedDirectory] !== undefined) return;
    if (loadingPaths.has(expandedDirectory)) return;
    const api = readNativeApi();
    if (!api) {
      setErrorMessage("App is still connecting. Try again in a moment.");
      return;
    }

    setLoadingPaths((current) => new Set(current).add(expandedDirectory));
    void api.projects
      .listDirectories({ cwd: expandedDirectory, includeFiles: true })
      .then((result) => {
        setEntriesByPath((current) => ({ ...current, [expandedDirectory]: result.entries }));
      })
      .catch((error) => {
        setEntriesByPath((current) => ({ ...current, [expandedDirectory]: [] }));
        setErrorMessage(summarizeDirectoryLoadError(error));
      })
      .finally(() => {
        setLoadingPaths((current) => {
          const next = new Set(current);
          next.delete(expandedDirectory);
          return next;
        });
      });
  }, [entriesByPath, expandedDirectory, isAwaitingHomeDir, loadingPaths]);

  const rawEntries = entriesByPath[expandedDirectory];
  const isLoading = loadingPaths.has(expandedDirectory);
  const { folders, files } = useMemo(
    () => filterLocalEntries(rawEntries, filter),
    [filter, rawEntries],
  );
  const currentFolderRow = useMemo<VisibleLocalDirectoryRow | null>(() => {
    if (isRootDirectory(directory) || filter.trim().length > 0) return null;
    return { kind: "use-current", separator: detectPathSeparator(directory) };
  }, [directory, filter]);

  const [debouncedFilter] = useDebouncedValue(filter, { wait: LOCAL_SEARCH_DEBOUNCE_MS });
  const trimmedDebouncedFilter = debouncedFilter.trim();
  const shouldRunFuzzySearch =
    !isAwaitingHomeDir &&
    expandedDirectory.length > 0 &&
    trimmedDebouncedFilter.length >= LOCAL_SEARCH_MIN_QUERY_LENGTH;
  const searchQuery = useQuery(
    projectSearchLocalEntriesQueryOptions({
      rootPath: shouldRunFuzzySearch ? expandedDirectory : null,
      query: trimmedDebouncedFilter,
      includeFiles: true,
      enabled: shouldRunFuzzySearch,
    }),
  );

  const searchRows = useMemo<ProjectLocalSearchEntry[]>(() => {
    if (!shouldRunFuzzySearch || !searchQuery.data) return [];
    const localPaths = new Set<string>();
    for (const entry of folders) localPaths.add(joinDirectoryPath(expandedDirectory, entry.name));
    for (const entry of files) localPaths.add(joinDirectoryPath(expandedDirectory, entry.name));
    const deduped: ProjectLocalSearchEntry[] = [];
    for (const entry of searchQuery.data.entries) {
      if (!localPaths.has(entry.path)) deduped.push(entry);
    }
    return deduped;
  }, [expandedDirectory, files, folders, searchQuery.data, shouldRunFuzzySearch]);

  const visibleRows = useMemo<VisibleLocalDirectoryRow[]>(() => {
    const rows: VisibleLocalDirectoryRow[] = [];
    if (currentFolderRow) rows.push(currentFolderRow);
    for (const entry of folders) rows.push({ kind: "entry", entry });
    for (const entry of files) rows.push({ kind: "entry", entry });
    for (const entry of searchRows) rows.push({ kind: "search", entry });
    return rows;
  }, [currentFolderRow, files, folders, searchRows]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      if (highlightedIndex !== 0) setHighlightedIndex(0);
      return;
    }
    if (highlightedIndex >= visibleRows.length) setHighlightedIndex(0);
  }, [highlightedIndex, visibleRows.length]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [directory, filter]);

  const handleSelectCurrentDirectory = useCallback(() => {
    void onSelectEntry(expandedDirectory, {
      kind: "directory",
      path: ".",
      name: basename(expandedDirectory) || expandedDirectory,
      hasChildren: folders.length > 0 || files.length > 0,
    });
  }, [expandedDirectory, files.length, folders.length, onSelectEntry]);

  const handleActivateEntry = useCallback(
    (entry: ProjectFileSystemEntry) => {
      if (entry.kind === "directory") {
        onNavigateFolder(joinDirectoryPath(directory, entry.name));
      } else {
        void onSelectEntry(joinDirectoryPath(expandedDirectory, entry.name), entry);
      }
    },
    [directory, expandedDirectory, onNavigateFolder, onSelectEntry],
  );

  const handleActivateSearchEntry = useCallback(
    (entry: ProjectLocalSearchEntry) => {
      if (entry.kind === "directory") {
        onNavigateFolder(entry.path);
        return;
      }
      void onSelectEntry(entry.path, { kind: "file", path: entry.path, name: entry.name });
    },
    [onNavigateFolder, onSelectEntry],
  );

  const handleActivateRow = useCallback(
    (row: VisibleLocalDirectoryRow) => {
      if (row.kind === "use-current") handleSelectCurrentDirectory();
      else if (row.kind === "search") handleActivateSearchEntry(row.entry);
      else handleActivateEntry(row.entry);
    },
    [handleActivateEntry, handleActivateSearchEntry, handleSelectCurrentDirectory],
  );

  const parent = parentDirectory(directory);
  const handleGoUp = useCallback(() => {
    if (parent) onNavigateFolder(parent);
  }, [onNavigateFolder, parent]);

  useImperativeHandle(
    handleRef,
    () => ({
      moveHighlight: (direction) => {
        if (visibleRows.length === 0) return;
        setHighlightedIndex((current) => {
          if (direction === "up") return current <= 0 ? visibleRows.length - 1 : current - 1;
          return current >= visibleRows.length - 1 ? 0 : current + 1;
        });
      },
      activateHighlighted: () => {
        const row = visibleRows[highlightedIndex];
        if (!row) return false;
        handleActivateRow(row);
        return true;
      },
    }),
    [handleActivateRow, highlightedIndex, visibleRows],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-highlight-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const entryRowStartIndex = currentFolderRow ? 1 : 0;
  return {
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
    headerLabel: directory || rootLabel,
    highlightedIndex,
    isAwaitingHomeDir,
    isLoading,
    isSearchPending: shouldRunFuzzySearch && searchQuery.isFetching && searchRows.length === 0,
    isSearchTruncated: searchQuery.data?.truncated === true,
    listRef,
    parent,
    searchRows,
    searchRowStartIndex: entryRowStartIndex + folders.length + files.length,
    setHighlightedIndex,
    visibleCount: visibleRows.length,
  };
}

export type LocalDirectoryMenuController = ReturnType<typeof useLocalDirectoryMenuController>;
