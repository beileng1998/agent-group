import { useMemo } from "react";
import { useTheme } from "../../hooks/useTheme";
import { getAvailableCodeThemes } from "../../theme/theme.logic";
import {
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchTheme,
  type SidebarSearchThread,
  matchSidebarSearchActions,
  matchSidebarSearchProjects,
  matchSidebarSearchThemes,
  matchSidebarSearchThreads,
} from "../SidebarSearchPalette.logic";
import { buildThemeCommandItems } from "./sidebarSearchReadModel";

interface UseSidebarSearchResultsInput {
  actions: readonly SidebarSearchAction[];
  isBrowsing: boolean;
  projects: readonly SidebarSearchProject[];
  query: string;
  threads: readonly SidebarSearchThread[];
}

export function useSidebarSearchResults(input: UseSidebarSearchResultsInput) {
  const { activeTheme, resolvedTheme, setCodeThemeId, setTheme, theme } = useTheme();
  const matchedActions = useMemo(
    () => (input.isBrowsing ? [] : matchSidebarSearchActions(input.actions, input.query)),
    [input.actions, input.isBrowsing, input.query],
  );
  const themeCommandItems = useMemo(
    () => buildThemeCommandItems({ query: input.query, resolvedTheme, theme }),
    [input.query, resolvedTheme, theme],
  );
  const currentCodeThemeItems = useMemo<SidebarSearchTheme[]>(
    () =>
      getAvailableCodeThemes(resolvedTheme).map((option) => ({
        id: `theme-code:${resolvedTheme}:${option.id}`,
        type: "code-theme",
        label: option.label,
        description: `Apply to the current ${resolvedTheme} theme slot.`,
        keywords: ["appearance", "theme", resolvedTheme, option.id],
        codeThemeId: option.id,
        variant: resolvedTheme,
        isActive: activeTheme.codeThemeId === option.id,
      })),
    [activeTheme.codeThemeId, resolvedTheme],
  );
  const matchedCurrentThemes = useMemo(
    () =>
      input.isBrowsing || input.query.trim().length === 0
        ? []
        : matchSidebarSearchThemes(currentCodeThemeItems, input.query),
    [currentCodeThemeItems, input.isBrowsing, input.query],
  );
  const showThemeSection =
    !input.isBrowsing &&
    input.query.trim().length > 0 &&
    (themeCommandItems.length > 0 || matchedCurrentThemes.length > 0);
  const matchedProjects = useMemo(
    () => (input.isBrowsing ? [] : matchSidebarSearchProjects(input.projects, input.query)),
    [input.isBrowsing, input.projects, input.query],
  );
  const matchedThreads = useMemo(
    () => (input.isBrowsing ? [] : matchSidebarSearchThreads(input.threads, input.query)),
    [input.isBrowsing, input.query, input.threads],
  );
  const hasSearchResults =
    matchedActions.length > 0 ||
    themeCommandItems.length > 0 ||
    matchedCurrentThemes.length > 0 ||
    matchedProjects.length > 0 ||
    matchedThreads.length > 0;

  return {
    hasSearchResults,
    matchedActions,
    matchedCurrentThemes,
    matchedProjects,
    matchedThreads,
    resolvedTheme,
    setCodeThemeId,
    setTheme,
    showThemeSection,
    themeCommandItems,
  };
}

export type SidebarSearchResults = ReturnType<typeof useSidebarSearchResults>;
