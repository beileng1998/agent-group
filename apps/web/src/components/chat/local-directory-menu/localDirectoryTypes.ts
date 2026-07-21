import type { ProjectFileSystemEntry, ProjectLocalSearchEntry } from "@agent-group/contracts";
import type { Ref } from "react";

export interface ComposerLocalDirectoryMenuHandle {
  moveHighlight: (direction: "up" | "down") => void;
  activateHighlighted: () => boolean;
}

export interface ComposerLocalDirectoryMenuProps {
  mentionQuery: string;
  rootLabel: string;
  homeDir: string | null;
  onSelectEntry: (absolutePath: string, entry: ProjectFileSystemEntry) => Promise<void> | void;
  onNavigateFolder: (absolutePath: string) => void;
  handleRef?: Ref<ComposerLocalDirectoryMenuHandle>;
}

export type EntriesByPath = Record<string, readonly ProjectFileSystemEntry[] | undefined>;

export type VisibleLocalDirectoryRow =
  | { kind: "use-current"; separator: "/" | "\\" }
  | { kind: "entry"; entry: ProjectFileSystemEntry }
  | { kind: "search"; entry: ProjectLocalSearchEntry };
