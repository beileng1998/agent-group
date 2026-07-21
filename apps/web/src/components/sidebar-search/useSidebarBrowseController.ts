import type { FilesystemBrowseResult } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  normalizeProjectPathForDispatch,
} from "~/lib/projectPaths";
import { isMacPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { expandHomeInPath } from "./sidebarSearchReadModel";

const BROWSE_STALE_TIME_MS = 10_000;
const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

interface UseSidebarBrowseControllerInput {
  homeDir: string | null;
  initialBrowseQuery?: string | null;
  onAddProjectPath: (path: string, options?: { createIfMissing?: boolean }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function useSidebarBrowseController(input: UseSidebarBrowseControllerInput) {
  const [query, setQuery] = useState(input.initialBrowseQuery ?? "");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);

  useEffect(() => {
    if (!input.open) {
      setQuery("");
      setHighlightedItemValue(null);
      setAddProjectError(null);
      setIsAddingProject(false);
    }
  }, [input.open]);

  useEffect(() => {
    setAddProjectError(null);
  }, [query]);

  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const trimmedQuery = query.trim();
  const unsupportedWindowsPath = isUnsupportedWindowsProjectPath(trimmedQuery, platform);
  const isBrowsing = trimmedQuery.length > 0 && isFilesystemBrowseQuery(trimmedQuery, platform);
  const canBrowse = isBrowsing && !unsupportedWindowsPath;
  const browseDirectoryPath = canBrowse ? getBrowseDirectoryPath(query) : "";
  const leafSegment =
    canBrowse && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";
  const expandedBrowsePath = canBrowse ? expandHomeInPath(browseDirectoryPath, input.homeDir) : "";

  const { data: browseResult, isFetching: isBrowseFetching } =
    useQuery<FilesystemBrowseResult | null>({
      queryKey: ["sidebar-palette-browse", expandedBrowsePath],
      queryFn: async () => {
        if (!canBrowse || expandedBrowsePath.length === 0) return null;
        const api = readNativeApi();
        if (!api) return null;
        return await api.filesystem.browse({ partialPath: expandedBrowsePath });
      },
      enabled: canBrowse && expandedBrowsePath.length > 0,
      staleTime: BROWSE_STALE_TIME_MS,
    });

  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const filteredBrowseEntries = useMemo(() => {
    const lowerFilter = leafSegment.toLowerCase();
    const showHidden = leafSegment.startsWith(".");
    return browseEntries.filter(
      (entry) =>
        entry.name.toLowerCase().startsWith(lowerFilter) &&
        (showHidden || !entry.name.startsWith(".")),
    );
  }, [browseEntries, leafSegment]);

  const exactBrowseEntry = useMemo(() => {
    if (leafSegment.length === 0) return null;
    return filteredBrowseEntries.find((entry) => entry.name === leafSegment) ?? null;
  }, [filteredBrowseEntries, leafSegment]);

  const browseParentPath = canBrowse ? getBrowseParentPath(query) : null;
  const canBrowseUp = canBrowse && canNavigateUp(query);
  const hasHighlightedFolderItem =
    highlightedItemValue !== null && highlightedItemValue.startsWith("folder:");
  const hasHighlightedBrowseItem =
    hasHighlightedFolderItem || highlightedItemValue === "__browse_up__";
  const highlightedFolderPath = hasHighlightedFolderItem
    ? (highlightedItemValue?.slice("folder:".length) ?? null)
    : null;
  const willCreateMissingFolder =
    canBrowse &&
    !hasHighlightedFolderItem &&
    trimmedQuery.length > 0 &&
    !hasTrailingPathSeparator(query) &&
    exactBrowseEntry === null &&
    !isBrowseFetching;
  const browseSubmitLabel = willCreateMissingFolder ? "Create & Add" : "Add";

  const resolveBrowseSubmitPath = (): string => {
    if (highlightedFolderPath) {
      return normalizeProjectPathForDispatch(highlightedFolderPath);
    }
    const raw = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? expandHomeInPath(trimmedQuery, input.homeDir))
      : (exactBrowseEntry?.fullPath ?? expandHomeInPath(trimmedQuery, input.homeDir));
    return normalizeProjectPathForDispatch(raw);
  };

  const submitBrowsePath = async () => {
    if (isAddingProject) return;
    if (trimmedQuery.length === 0 && !highlightedFolderPath) {
      setAddProjectError("Enter a folder path.");
      return;
    }
    if (unsupportedWindowsPath) {
      setAddProjectError("Windows paths are not supported on this platform.");
      return;
    }
    if (!highlightedFolderPath && isExplicitRelativeProjectPath(trimmedQuery)) {
      setAddProjectError(
        "Relative paths are not supported. Use an absolute path or start with ~/.",
      );
      return;
    }
    setIsAddingProject(true);
    setAddProjectError(null);
    try {
      await input.onAddProjectPath(resolveBrowseSubmitPath(), {
        createIfMissing: willCreateMissingFolder,
      });
      input.onOpenChange(false);
    } catch (cause) {
      setAddProjectError(cause instanceof Error ? cause.message : "Failed to add project.");
    } finally {
      setIsAddingProject(false);
    }
  };

  const isMac = isMacPlatform(platform);
  const submitModifierLabel = isMac ? "⌘" : "Ctrl";
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isBrowsing) return;
    const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;
    if (
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || (isModifierPressed && hasHighlightedFolderItem))
    ) {
      event.preventDefault();
      void submitBrowsePath();
      return;
    }
    if (
      event.key === "Backspace" &&
      hasTrailingPathSeparator(query) &&
      browseParentPath &&
      event.currentTarget.selectionStart === query.length &&
      event.currentTarget.selectionEnd === query.length
    ) {
      event.preventDefault();
      setQuery(browseParentPath);
    }
  };

  return {
    addProjectError,
    browseParentPath,
    browseSubmitLabel,
    canBrowseUp,
    filteredBrowseEntries,
    handleInputKeyDown,
    hasHighlightedBrowseItem,
    hasHighlightedFolderItem,
    highlightedFolderPath,
    isAddingProject,
    isBrowseFetching,
    isBrowsing,
    openFolder: (name: string) => setQuery(appendBrowsePathSegment(query, name)),
    query,
    setHighlightedItemValue,
    setQuery,
    submitBrowsePath,
    submitModifierLabel,
    trimmedQuery,
    unsupportedWindowsPath,
    willCreateMissingFolder,
  };
}

export type SidebarBrowseController = ReturnType<typeof useSidebarBrowseController>;
