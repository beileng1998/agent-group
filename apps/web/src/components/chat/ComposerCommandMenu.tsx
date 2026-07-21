import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { type ComposerTriggerKind } from "../../composer-logic";
import {
  BotIcon,
  BrainIcon,
  BugIcon,
  ChangesIcon,
  ClockIcon,
  DeviceLaptopIcon,
  EraserIcon,
  FastModeIcon,
  GitBranchIcon,
  GitForkIcon,
  InfoIcon,
  ListTodoIcon,
  type LucideIcon,
  MessageCircleIcon,
  Minimize2,
  PluginIcon,
  SkillCubeIcon,
  TemporaryThreadIcon,
  TerminalIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command";
import { FileEntryIcon } from "./FileEntryIcon";
import {
  COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME,
  COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME,
  COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME,
} from "./composerPickerStyles";
import {
  commandMenuSecondaryText,
  commandMenuTitle,
  commandMenuTrailingMeta,
  groupCommandItems,
  type ComposerCommandItem,
} from "./composer-command-menu/commandMenuModel";

export {
  groupCommandItems,
  type ComposerCommandItem,
} from "./composer-command-menu/commandMenuModel";

const COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME =
  "px-2 pt-1.5 pb-1 text-[11px] font-normal text-muted-foreground/60";

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  groupSlashCommandSections?: boolean;
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const groups = useMemo(
    () =>
      groupCommandItems(props.items, props.triggerKind, props.groupSlashCommandSections ?? true),
    [props.groupSlashCommandSections, props.items, props.triggerKind],
  );

  useEffect(() => {
    if (!props.activeItemId) {
      return;
    }

    itemRefs.current[props.activeItemId]?.scrollIntoView({
      block: "nearest",
    });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div className={COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME}>
        <CommandList className="max-h-72 scroll-py-1 p-1">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 ? <CommandSeparator className="my-0.5" /> : null}
              <CommandGroup>
                {group.label ? (
                  <CommandGroupLabel className={COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME}>
                    {group.label}
                  </CommandGroupLabel>
                ) : null}
                {group.items.map((item) => (
                  <ComposerCommandMenuItem
                    key={item.id}
                    item={item}
                    resolvedTheme={props.resolvedTheme}
                    isActive={props.activeItemId === item.id}
                    itemRef={(node) => {
                      itemRefs.current[item.id] = node;
                    }}
                    onHighlight={props.onHighlightedItemChange}
                    onSelect={props.onSelect}
                  />
                ))}
              </CommandGroup>
            </div>
          ))}
          {props.triggerKind === "mention" ? (
            <>
              {groups.length > 0 ? <CommandSeparator className="my-0.5" /> : null}
              {/* This footer is informational copy, not a selectable result group. */}
              <div className="pt-0.5 pb-2">
                <p
                  className={cn(
                    COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME,
                    "px-2 py-0 font-medium text-muted-foreground text-xs",
                  )}
                >
                  Files
                </p>
                <p className="px-2 pt-0.5 text-[11px] text-muted-foreground/55">
                  Type to search for files
                </p>
              </div>
            </>
          ) : null}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">
            {props.isLoading
              ? props.triggerKind === "mention"
                ? "Searching mentions..."
                : props.triggerKind === "skill"
                  ? "Loading skills..."
                  : "Loading commands..."
              : (props.emptyStateText ??
                (props.triggerKind === "mention"
                  ? "No matching session, plugin, or file."
                  : props.triggerKind === "skill"
                    ? "No matching skill."
                    : "No matching command."))}
          </p>
        )}
      </div>
    </Command>
  );
});

// Single icon column shared by every menu row. Rows differ only by the glyph,
// its color, and the name — slot geometry stays constant so files, folders,
// skills, plugins, commands, and agents line up identically.
const COMPOSER_COMMAND_ITEM_ICON_SLOT_CLASSNAME =
  "flex size-4 shrink-0 items-center justify-center text-muted-foreground/60";

// Files mirror the recap / diff changed-files treatment (FileEntryIcon at
// size-3.5 with the same dimmed foreground) so a file reads identically whether
// it appears in a turn summary or in the composer.
const COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME =
  "size-3.5 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80";

const COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME = "size-3.5";

// Reuse the app's existing icon components for each concept so the command menu
// stays coherent with how plan/fork/review/model/etc. appear everywhere else.
// Don't introduce bespoke glyphs here — map to the shared `~/lib/icons` exports.
const SLASH_COMMAND_ICONS: Record<string, LucideIcon> = {
  clear: EraserIcon,
  compact: Minimize2,
  model: BrainIcon,
  fast: FastModeIcon,
  plan: ListTodoIcon,
  default: MessageCircleIcon,
  review: BugIcon,
  fork: GitForkIcon,
  side: TemporaryThreadIcon,
  status: InfoIcon,
  subagents: BotIcon,
  feedback: BugIcon,
  automation: ClockIcon,
};

function commandMenuSlashGlyph(command: string, fallback: LucideIcon): ReactNode {
  const Icon = SLASH_COMMAND_ICONS[command] ?? fallback;
  return <Icon className={COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME} />;
}

function commandMenuItemGlyph(item: ComposerCommandItem, theme: "light" | "dark"): ReactNode {
  const cls = COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME;
  switch (item.type) {
    case "path":
      return (
        <FileEntryIcon
          pathValue={item.path}
          kind={item.pathKind}
          theme={theme}
          className={
            item.pathKind === "directory" ? cls : COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME
          }
        />
      );
    case "local-root":
      return <DeviceLaptopIcon className={cls} />;
    case "session":
      return <MessageCircleIcon className={cls} />;
    case "fork-target":
      return item.target === "local" ? (
        <DeviceLaptopIcon className={cls} />
      ) : (
        <WorktreeIcon className={cls} />
      );
    case "review-target":
      return item.target === "changes" ? (
        <ChangesIcon className={cls} />
      ) : (
        <GitBranchIcon className={cls} />
      );
    case "slash-command":
      return commandMenuSlashGlyph(item.command, TerminalIcon);
    case "provider-native-command":
      // Provider native commands surface skills (e.g. Claude exposes skills as
      // slash commands), so default to the skill block glyph used for skill
      // tokens in the composer/timeline — named commands still keep their icon.
      return commandMenuSlashGlyph(item.command, SkillCubeIcon);
    case "model":
      return <BrainIcon className={cls} />;
    case "agent":
      return <BotIcon className={cls} />;
    case "plugin":
      return <PluginIcon className={cls} />;
    case "skill":
      return <SkillCubeIcon className={cls} />;
    default:
      return null;
  }
}

const ComposerCommandItemIcon = memo(function ComposerCommandItemIcon(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
}) {
  return (
    <span
      className={cn(
        COMPOSER_COMMAND_ITEM_ICON_SLOT_CLASSNAME,
        props.isActive && "text-foreground/70",
      )}
    >
      {commandMenuItemGlyph(props.item, props.resolvedTheme)}
    </span>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  itemRef: (node: HTMLElement | null) => void;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const secondaryText = commandMenuSecondaryText(props.item);
  const trailingMeta = commandMenuTrailingMeta(props.item);

  return (
    <CommandItem
      ref={props.itemRef}
      value={props.item.id}
      className={cn(
        COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME,
        props.isActive && COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME,
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      <ComposerCommandItemIcon
        item={props.item}
        resolvedTheme={props.resolvedTheme}
        isActive={props.isActive}
      />
      <div className="min-w-0 flex flex-1 items-center gap-3">
        <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 text-[11.5px] font-medium text-foreground/80">
            {props.item.type === "slash-command" || props.item.type === "provider-native-command"
              ? commandMenuTitle(props.item)
              : props.item.label}
          </span>
          {secondaryText ? (
            <span className="truncate text-[11px] text-muted-foreground/55">{secondaryText}</span>
          ) : null}
        </div>
        {trailingMeta ? (
          <span className="shrink-0 pl-2 text-right text-[10.5px] text-muted-foreground/42">
            {trailingMeta}
          </span>
        ) : null}
      </div>
    </CommandItem>
  );
});
