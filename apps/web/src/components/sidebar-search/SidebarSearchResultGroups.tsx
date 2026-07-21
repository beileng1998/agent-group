import { isGenericChatThreadTitle } from "@agent-group/shared/chatThreads";
import { HiOutlineFolderOpen } from "react-icons/hi2";
import { CheckIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { getCodeThemeSeed } from "../../theme/theme.logic";
import type { SidebarSearchAction } from "../SidebarSearchPalette.logic";
import { CommandGroup, CommandGroupLabel, CommandItem, CommandSeparator } from "../ui/command";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import {
  ACTION_ICONS,
  CodeThemeBadge,
  HighlightedText,
  PaletteIcon,
  ProviderIcon,
  THEME_MODE_ICONS,
} from "./SidebarSearchPrimitives";
import { threadMatchLabel } from "./sidebarSearchReadModel";
import type { SidebarSearchResults } from "./useSidebarSearchResults";

interface SidebarSearchResultGroupsProps {
  onOpenChange: (open: boolean) => void;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
  onSelectAction: (action: SidebarSearchAction) => void;
  query: string;
  results: SidebarSearchResults;
}

export function SidebarSearchResultGroups(props: SidebarSearchResultGroupsProps) {
  const { results } = props;
  return (
    <>
      {results.matchedActions.length > 0 ? (
        <CommandGroup>
          <CommandGroupLabel className="pt-0 pb-1.5 pl-3">Suggested</CommandGroupLabel>
          {results.matchedActions.map((action) => {
            const Icon = ACTION_ICONS[action.id];
            return (
              <CommandItem
                key={action.id}
                value={`action:${action.id}`}
                className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onSelectAction(action)}
              >
                {Icon ? <PaletteIcon icon={Icon} /> : null}
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {action.label}
                </span>
                {action.shortcutLabel ? (
                  <ShortcutKbd shortcutLabel={action.shortcutLabel} groupClassName="shrink-0" />
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ) : null}

      {results.matchedActions.length > 0 &&
      (results.matchedThreads.length > 0 ||
        results.matchedProjects.length > 0 ||
        results.showThemeSection) ? (
        <CommandSeparator />
      ) : null}

      {results.matchedThreads.length > 0 ? (
        <CommandGroup>
          <CommandGroupLabel className="py-1.5 pl-3">
            {props.query ? "Threads" : "Recent"}
          </CommandGroupLabel>
          {results.matchedThreads.map(({ id, matchKind, messageMatchCount, snippet, thread }) => (
            <CommandItem
              key={id}
              value={id}
              className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                props.onOpenChange(false);
                props.onOpenThread(thread.id);
              }}
            >
              {isGenericChatThreadTitle(thread.title) ? null : (
                <ProviderIcon provider={thread.provider} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <div className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] text-foreground">
                    <HighlightedText text={thread.title || "Untitled thread"} query={props.query} />
                  </div>
                  <span className="w-24 shrink-0 truncate text-right text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/79">
                    {thread.projectName}
                  </span>
                  {thread.updatedAt || thread.createdAt ? (
                    <span className="w-10 shrink-0 text-right text-[length:var(--app-font-size-ui-timestamp,10px)] text-muted-foreground/79">
                      {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                    </span>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                </div>
                {snippet ? (
                  <div className="mt-0.5 flex items-start gap-3">
                    <div className="min-w-0 flex-1 line-clamp-1 text-[length:var(--app-font-size-ui-meta,10px)] leading-5 text-muted-foreground/78">
                      <HighlightedText text={snippet} query={props.query} />
                    </div>
                    <div className="flex w-[8.5rem] shrink-0 justify-end">
                      {threadMatchLabel({ matchKind, messageMatchCount }) ? (
                        <span className="truncate text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/58">
                          {threadMatchLabel({ matchKind, messageMatchCount })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : threadMatchLabel({ matchKind, messageMatchCount }) ? (
                  <div className="mt-0.5 text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/58">
                    {threadMatchLabel({ matchKind, messageMatchCount })}
                  </div>
                ) : null}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {results.matchedThreads.length > 0 &&
      (results.matchedProjects.length > 0 || results.showThemeSection) ? (
        <CommandSeparator />
      ) : null}

      {results.matchedProjects.length > 0 ? (
        <CommandGroup>
          <CommandGroupLabel className="py-1.5 pl-3">Projects</CommandGroupLabel>
          {results.matchedProjects.map(({ id, project }) => (
            <CommandItem
              key={id}
              value={id}
              className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                props.onOpenChange(false);
                props.onOpenProject(project.id);
              }}
            >
              <PaletteIcon icon={HiOutlineFolderOpen} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[length:var(--app-font-size-ui,12px)] text-foreground">
                  {project.name || "Untitled project"}
                </div>
                <div className="truncate text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/79">
                  {project.localName ? `${project.folderName} · ${project.cwd}` : project.cwd}
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {results.showThemeSection && results.matchedProjects.length > 0 ? <CommandSeparator /> : null}

      {results.showThemeSection ? (
        <>
          {results.themeCommandItems.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel className="py-1.5 pl-3">Configure</CommandGroupLabel>
              {results.themeCommandItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  className="cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (item.isActive) return;
                    props.onOpenChange(false);
                    results.setTheme(item.mode);
                  }}
                >
                  <PaletteIcon icon={THEME_MODE_ICONS[item.mode]} />
                  <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] text-foreground">
                    {item.label}
                  </span>
                  <span
                    className="flex size-3.5 shrink-0 items-center justify-center"
                    aria-hidden={!item.isActive}
                  >
                    {item.isActive ? (
                      <CheckIcon className="size-3.5 text-muted-foreground/79" />
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.matchedCurrentThemes.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel className="py-1.5 pl-3">
                {results.resolvedTheme === "dark" ? "Dark themes" : "Light themes"}
              </CommandGroupLabel>
              {results.matchedCurrentThemes.map((item) => {
                const seed =
                  item.codeThemeId && item.variant
                    ? getCodeThemeSeed(item.codeThemeId, item.variant)
                    : null;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    className="cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!item.codeThemeId || !item.variant) return;
                      props.onOpenChange(false);
                      results.setCodeThemeId(item.variant, item.codeThemeId);
                    }}
                  >
                    {seed ? (
                      <CodeThemeBadge
                        accent={seed.accent}
                        background={seed.surface}
                        foreground={seed.ink}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] text-foreground">
                      {item.label}
                    </span>
                    <span className="shrink-0 text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/79">
                      {results.resolvedTheme === "dark" ? "Dark color theme" : "Light color theme"}
                    </span>
                    <span
                      className="flex size-3.5 shrink-0 items-center justify-center"
                      aria-hidden={!item.isActive}
                    >
                      {item.isActive ? (
                        <CheckIcon className="size-3.5 text-muted-foreground/79" />
                      ) : null}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
        </>
      ) : null}
    </>
  );
}
