import { LuFolderPlus } from "react-icons/lu";
import { SearchIcon } from "~/lib/icons";
import { isExplicitRelativeProjectPath } from "~/lib/projectPaths";
import type { SidebarSearchAction } from "../SidebarSearchPalette.logic";
import { Button } from "../ui/button";
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandList,
  CommandPanel,
} from "../ui/command";
import { Kbd, KbdGroup } from "../ui/kbd";
import { SidebarSearchBrowseResults } from "./SidebarSearchBrowseResults";
import { SidebarSearchResultGroups } from "./SidebarSearchResultGroups";
import type { SidebarBrowseController } from "./useSidebarBrowseController";
import type { SidebarSearchResults } from "./useSidebarSearchResults";

interface SidebarSearchSurfaceProps {
  browse: SidebarBrowseController;
  onOpenChange: (open: boolean) => void;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
  onSelectAction: (action: SidebarSearchAction) => void;
  results: SidebarSearchResults;
}

export function SidebarSearchSurface(props: SidebarSearchSurfaceProps) {
  const { browse } = props;
  return (
    <Command
      autoHighlight={browse.isBrowsing ? false : "always"}
      mode="none"
      onItemHighlighted={(value) => {
        browse.setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
    >
      <CommandPanel className="overflow-hidden">
        <div className="relative">
          <CommandInput
            placeholder={
              browse.isBrowsing
                ? "Enter project path (e.g. ~/projects/my-app)"
                : "Search projects, threads, and actions"
            }
            value={browse.query}
            onChange={(event) => browse.setQuery(event.currentTarget.value)}
            onKeyDown={browse.handleInputKeyDown}
            startAddon={
              browse.isBrowsing ? (
                <LuFolderPlus className="text-muted-foreground" />
              ) : (
                <SearchIcon className="text-muted-foreground" />
              )
            }
            className={
              browse.isBrowsing ? (browse.willCreateMissingFolder ? "pe-36" : "pe-24") : undefined
            }
          />
          {browse.isBrowsing ? (
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className="-translate-y-1/2 absolute end-3 top-1/2 gap-1.5 pe-1 ps-2"
              disabled={
                browse.isAddingProject ||
                browse.unsupportedWindowsPath ||
                (browse.trimmedQuery.length === 0 && !browse.highlightedFolderPath) ||
                (!browse.highlightedFolderPath &&
                  isExplicitRelativeProjectPath(browse.trimmedQuery))
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void browse.submitBrowsePath()}
              title={
                browse.hasHighlightedFolderItem
                  ? `${browse.browseSubmitLabel} highlighted folder (${browse.submitModifierLabel} Enter)`
                  : `${browse.browseSubmitLabel} (Enter)`
              }
            >
              <span>{browse.browseSubmitLabel}</span>
              <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
                <Kbd>
                  {browse.hasHighlightedFolderItem
                    ? `${browse.submitModifierLabel} Enter`
                    : "Enter"}
                </Kbd>
              </KbdGroup>
            </Button>
          ) : null}
        </div>
        <CommandList className="max-h-[min(24rem,60vh)] not-empty:px-1.5 not-empty:pt-0 not-empty:pb-1.5">
          {browse.isBrowsing ? <SidebarSearchBrowseResults controller={browse} /> : null}
          {!browse.isBrowsing ? (
            <SidebarSearchResultGroups
              query={browse.query}
              results={props.results}
              onOpenChange={props.onOpenChange}
              onOpenProject={props.onOpenProject}
              onOpenThread={props.onOpenThread}
              onSelectAction={props.onSelectAction}
            />
          ) : null}
          {!browse.isBrowsing && !props.results.hasSearchResults ? (
            <CommandEmpty className="py-10">
              <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground/79">
                <SearchIcon className="size-4 opacity-70" />
                <div>No matches.</div>
              </div>
            </CommandEmpty>
          ) : null}
        </CommandList>
        <div className="h-1.5" />
      </CommandPanel>
      <CommandFooter>
        {browse.isBrowsing ? (
          <>
            <span>
              {browse.isAddingProject
                ? "Adding project..."
                : "Type a path, ↑↓ to navigate folders."}
            </span>
            <span>
              {browse.hasHighlightedFolderItem
                ? `Enter to open · ${browse.submitModifierLabel}+Enter to add`
                : browse.hasHighlightedBrowseItem
                  ? "Enter to go up"
                  : "Enter to add project"}
            </span>
          </>
        ) : (
          <>
            <span>Jump to threads, projects, actions, or appearance.</span>
            <span>Enter to open</span>
          </>
        )}
      </CommandFooter>
    </Command>
  );
}
