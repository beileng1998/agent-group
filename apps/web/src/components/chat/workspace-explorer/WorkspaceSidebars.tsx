import type { ChatFileReference } from "~/lib/chatReferences";
import { useExplorerListNavigation } from "../explorerListNavigation";
import { PanelStateMessage } from "../PanelStateMessage";
import {
  useExplorerEntryPrefetch,
  useResultEntryContextMenu,
  useTreeEntryContextMenu,
} from "./explorerActions";
import {
  useWorkspaceFileSearch,
  WorkspaceSearchInputHeader,
  WorkspaceSearchResultsBody,
} from "./WorkspaceSearch";
import { WorkspaceFilesTreeBody } from "./WorkspaceTree";

const EXPLORER_SIDEBAR_CONTAINER_CLASS =
  "flex min-h-[11rem] w-full shrink-0 flex-col border-b border-border/65 bg-[var(--color-background-surface)] lg:h-full lg:w-56 lg:border-b-0 lg:border-r";

interface WorkspaceSidebarBaseProps {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  containerClassName?: string;
  onSelectFile: (path: string) => void;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
}

export function WorkspaceFilesSidebar(
  props: WorkspaceSidebarBaseProps & {
    expandedDirectories: ReadonlySet<string>;
    onToggleDirectory: (path: string) => void;
  },
) {
  const prefetchEntry = useExplorerEntryPrefetch(props.workspaceRoot);
  const handleEntryContextMenu = useTreeEntryContextMenu(props.onReferenceInChat);
  const handleListKeyDown = useExplorerListNavigation();
  return (
    <aside
      className={props.containerClassName ?? EXPLORER_SIDEBAR_CONTAINER_CLASS}
      onKeyDown={handleListKeyDown}
    >
      <WorkspaceFilesTreeBody
        workspaceRoot={props.workspaceRoot}
        selectedFilePath={props.selectedFilePath}
        expandedDirectories={props.expandedDirectories}
        onSelectFile={props.onSelectFile}
        onToggleDirectory={props.onToggleDirectory}
        onPrefetchEntry={prefetchEntry}
        onEntryContextMenu={handleEntryContextMenu}
      />
    </aside>
  );
}

export function WorkspaceSearchSidebar(
  props: WorkspaceSidebarBaseProps & {
    query: string;
    onQueryChange: (query: string) => void;
  },
) {
  const prefetchEntry = useExplorerEntryPrefetch(props.workspaceRoot);
  const handleEntryContextMenu = useResultEntryContextMenu(props.onReferenceInChat);
  const handleListKeyDown = useExplorerListNavigation();
  const search = useWorkspaceFileSearch(props.workspaceRoot, props.query);

  return (
    <aside
      className={props.containerClassName ?? EXPLORER_SIDEBAR_CONTAINER_CLASS}
      onKeyDown={handleListKeyDown}
    >
      <WorkspaceSearchInputHeader
        query={props.query}
        search={search}
        autoFocus
        onQueryChange={props.onQueryChange}
        onSelectFile={props.onSelectFile}
      />
      {search.inputQuery.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col px-1 py-1">
          <PanelStateMessage density="compact" fill="flex">
            <p>Search files by name or path.</p>
          </PanelStateMessage>
        </div>
      ) : (
        <WorkspaceSearchResultsBody
          workspaceRoot={props.workspaceRoot}
          search={search}
          selectedFilePath={props.selectedFilePath}
          onSelectFile={props.onSelectFile}
          onPrefetchEntry={prefetchEntry}
          onEntryContextMenu={handleEntryContextMenu}
        />
      )}
    </aside>
  );
}

export function WorkspaceExplorerSidebar(
  props: WorkspaceSidebarBaseProps & {
    expandedDirectories: ReadonlySet<string>;
    query: string;
    onQueryChange: (query: string) => void;
    onToggleDirectory: (path: string) => void;
  },
) {
  const prefetchEntry = useExplorerEntryPrefetch(props.workspaceRoot);
  const handleTreeEntryContextMenu = useTreeEntryContextMenu(props.onReferenceInChat);
  const handleResultEntryContextMenu = useResultEntryContextMenu(props.onReferenceInChat);
  const handleListKeyDown = useExplorerListNavigation();
  const search = useWorkspaceFileSearch(props.workspaceRoot, props.query);

  return (
    <aside
      className={props.containerClassName ?? EXPLORER_SIDEBAR_CONTAINER_CLASS}
      onKeyDown={handleListKeyDown}
    >
      <WorkspaceSearchInputHeader
        query={props.query}
        search={search}
        onQueryChange={props.onQueryChange}
        onSelectFile={props.onSelectFile}
      />
      {search.inputQuery.length === 0 ? (
        <WorkspaceFilesTreeBody
          workspaceRoot={props.workspaceRoot}
          selectedFilePath={props.selectedFilePath}
          expandedDirectories={props.expandedDirectories}
          onSelectFile={props.onSelectFile}
          onToggleDirectory={props.onToggleDirectory}
          onPrefetchEntry={prefetchEntry}
          onEntryContextMenu={handleTreeEntryContextMenu}
        />
      ) : (
        <WorkspaceSearchResultsBody
          workspaceRoot={props.workspaceRoot}
          search={search}
          selectedFilePath={props.selectedFilePath}
          onSelectFile={props.onSelectFile}
          onPrefetchEntry={prefetchEntry}
          onEntryContextMenu={handleResultEntryContextMenu}
        />
      )}
    </aside>
  );
}
