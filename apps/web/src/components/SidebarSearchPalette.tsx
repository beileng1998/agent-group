/**
 * Command-style palette for sidebar actions, threads, projects, and imports.
 * Domain state and result surfaces live in sidebar-search; this file preserves
 * the public entry point used by the sidebar shell.
 */
import { getInitialBrowseQuery } from "~/lib/projectPaths";
import type { SidebarSearchAction } from "./SidebarSearchPalette.logic";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { SidebarSearchImportSurface } from "./sidebar-search/SidebarSearchImportSurface";
import { SidebarSearchSurface } from "./sidebar-search/SidebarSearchSurface";
import { resolveSidebarActionHandler } from "./sidebar-search/sidebarSearchReadModel";
import type { SidebarSearchPaletteProps } from "./sidebar-search/sidebarSearchTypes";
import { useSidebarBrowseController } from "./sidebar-search/useSidebarBrowseController";
import { useSidebarImportController } from "./sidebar-search/useSidebarImportController";
import { useSidebarSearchResults } from "./sidebar-search/useSidebarSearchResults";

export type {
  ImportProviderKind,
  SidebarSearchPaletteMode,
} from "./sidebar-search/sidebarSearchTypes";

export function SidebarSearchPalette(props: SidebarSearchPaletteProps) {
  const browse = useSidebarBrowseController({
    homeDir: props.homeDir,
    ...(props.initialBrowseQuery !== undefined
      ? { initialBrowseQuery: props.initialBrowseQuery }
      : {}),
    onAddProjectPath: props.onAddProjectPath,
    onOpenChange: props.onOpenChange,
    open: props.open,
  });
  const importer = useSidebarImportController({
    importProviders: props.importProviders,
    onImportThread: props.onImportThread,
    onOpenChange: props.onOpenChange,
    open: props.open,
  });
  const results = useSidebarSearchResults({
    actions: props.actions,
    isBrowsing: browse.isBrowsing,
    projects: props.projects,
    query: browse.query,
    threads: props.threads,
  });

  const selectAction = (action: SidebarSearchAction) => {
    const onSelect = resolveSidebarActionHandler(action.id, props);
    if (action.id === "import-thread") {
      importer.resetError();
      importer.setId("");
      importer.setProvider(props.importProviders[0] ?? "codex");
      props.onModeChange("import");
      return;
    }
    if (action.id === "add-project") {
      browse.setQuery(getInitialBrowseQuery(props.homeDir));
      return;
    }
    if (!onSelect) return;
    props.onOpenChange(false);
    onSelect();
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className="max-w-2xl">
        {props.mode === "import" ? (
          <SidebarSearchImportSurface
            controller={importer}
            importProviders={props.importProviders}
            onModeChange={props.onModeChange}
            onOpenChange={props.onOpenChange}
          />
        ) : (
          <SidebarSearchSurface
            browse={browse}
            results={results}
            onOpenChange={props.onOpenChange}
            onOpenProject={props.onOpenProject}
            onOpenThread={props.onOpenThread}
            onSelectAction={selectAction}
          />
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
