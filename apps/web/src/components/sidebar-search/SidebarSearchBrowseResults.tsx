import { LuCornerLeftUp } from "react-icons/lu";
import { FolderClosed } from "../FolderClosed";
import { CommandEmpty, CommandGroup, CommandItem } from "../ui/command";
import type { SidebarBrowseController } from "./useSidebarBrowseController";

export function SidebarSearchBrowseResults(props: { controller: SidebarBrowseController }) {
  const browse = props.controller;
  if (browse.unsupportedWindowsPath) {
    return (
      <CommandEmpty className="py-10">
        <div className="text-center text-sm text-muted-foreground/79">
          Windows paths are not supported on this platform.
        </div>
      </CommandEmpty>
    );
  }

  return (
    <>
      {browse.canBrowseUp || browse.filteredBrowseEntries.length > 0 ? (
        <CommandGroup>
          {browse.canBrowseUp ? (
            <CommandItem
              key="browse-up"
              value="__browse_up__"
              className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (browse.browseParentPath) browse.setQuery(browse.browseParentPath);
              }}
            >
              <LuCornerLeftUp className="size-3.5 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">..</span>
            </CommandItem>
          ) : null}
          {browse.filteredBrowseEntries.map((entry) => (
            <CommandItem
              key={entry.fullPath}
              value={`folder:${entry.fullPath}`}
              className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => browse.openFolder(entry.name)}
            >
              <FolderClosed className="size-3.5 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{entry.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : !browse.isBrowseFetching ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">No matching folders.</div>
      ) : null}
      {browse.willCreateMissingFolder ? (
        <div className="mx-1.5 mt-2 rounded-md border border-dashed border-[color:var(--color-border)] px-3 py-2 text-sm text-muted-foreground">
          Press Enter to create <span className="text-foreground">{browse.trimmedQuery}</span> and
          add it as a project.
        </div>
      ) : null}
      {browse.addProjectError ? (
        <div className="mx-1.5 mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {browse.addProjectError}
        </div>
      ) : null}
    </>
  );
}
