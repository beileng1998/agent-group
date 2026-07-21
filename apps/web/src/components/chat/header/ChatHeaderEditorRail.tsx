import type { ProjectId, ProviderKind, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppSettings } from "../../../appSettings";
import {
  readEditorRailChatTabs,
  storeEditorRailChatTabs,
  type EditorRailChatTabSnapshot,
} from "../../../editorViewState";
import { useStore } from "../../../store";
import { createSidebarDisplayThreadsSelector } from "../../../storeSelectors";
import { CheckIcon, HistoryIcon, MessageCircleIcon, PlusIcon, TerminalIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { sortThreadsForSidebar } from "../../Sidebar.logic";
import { IconButton } from "../../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { ProviderIcon } from "../../ProviderIcon";
import { SurfaceTabChip } from "../chatHeaderControls";
import type { EditorChatControls } from "./chatHeaderTypes";

const EDITOR_CHAT_HISTORY_LIMIT = 30;

type EditorRailChatTab = EditorRailChatTabSnapshot;

function EditorChatHistoryMenu(props: {
  projectId: ProjectId;
  activeThreadId: ThreadId;
  onNavigateToThread: (threadId: ThreadId) => void;
}) {
  const { settings } = useAppSettings();
  const selectDisplayThreads = useMemo(() => createSidebarDisplayThreadsSelector(), []);
  const displayThreads = useStore(selectDisplayThreads);
  const historyThreads = useMemo(
    () =>
      sortThreadsForSidebar(
        displayThreads.filter((thread) => thread.projectId === props.projectId),
        settings.sidebarThreadSortOrder,
      ).slice(0, EDITOR_CHAT_HISTORY_LIMIT),
    [displayThreads, props.projectId, settings.sidebarThreadSortOrder],
  );

  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <IconButton
            variant="ghost"
            size="icon-xs"
            label="Chat history"
            title="Chat history"
            className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <HistoryIcon className="size-3.5" />
          </IconButton>
        }
      />
      <ComposerPickerMenuPopup align="start" side="bottom" sideOffset={6} className="w-72 min-w-72">
        {historyThreads.length === 0 ? (
          <MenuItem disabled>No chats in this project yet</MenuItem>
        ) : (
          historyThreads.map((thread) => (
            <MenuItem
              key={thread.id}
              onClick={() => {
                if (thread.id !== props.activeThreadId) {
                  props.onNavigateToThread(thread.id);
                }
              }}
            >
              <ProviderIcon
                provider={thread.session?.provider ?? thread.modelSelection.provider}
                tone="header"
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              {thread.id === props.activeThreadId ? (
                <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                </span>
              )}
            </MenuItem>
          ))
        )}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function ChatHeaderEditorRail(props: {
  controls: EditorChatControls;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProvider: ProviderKind;
  onNavigateToThread: (threadId: ThreadId) => void;
}) {
  const { controls } = props;
  const { settings } = useAppSettings();
  const [openChatTabs, setOpenChatTabs] = useState<ReadonlyArray<EditorRailChatTab>>(() => {
    const storedTabs = readEditorRailChatTabs(controls.projectId);
    return storedTabs.length > 0
      ? storedTabs
      : [
          {
            id: props.activeThreadId,
            title: props.activeThreadTitle,
            provider: props.activeProvider,
          },
        ];
  });
  const [terminalTabOpen, setTerminalTabOpen] = useState(controls.terminalAvailable);
  const selectDisplayThreads = useMemo(() => createSidebarDisplayThreadsSelector(), []);
  const displayThreads = useStore(selectDisplayThreads);
  const currentChatTab = useMemo<EditorRailChatTab>(
    () => ({
      id: props.activeThreadId,
      title: props.activeThreadTitle,
      provider: props.activeProvider,
    }),
    [props.activeProvider, props.activeThreadId, props.activeThreadTitle],
  );
  const setAndStoreOpenChatTabs = useCallback(
    (updater: (current: ReadonlyArray<EditorRailChatTab>) => ReadonlyArray<EditorRailChatTab>) => {
      setOpenChatTabs((current) => {
        const next = updater(current);
        storeEditorRailChatTabs(controls.projectId, next);
        return next;
      });
    },
    [controls.projectId],
  );

  useEffect(() => {
    const storedTabs = readEditorRailChatTabs(controls.projectId);
    setOpenChatTabs(
      storedTabs.length > 0
        ? storedTabs
        : [
            {
              id: props.activeThreadId,
              title: props.activeThreadTitle,
              provider: props.activeProvider,
            },
          ],
    );
  }, [controls.projectId, props.activeProvider, props.activeThreadId, props.activeThreadTitle]);

  useEffect(() => {
    if (controls.terminalAvailable) {
      setTerminalTabOpen(true);
    }
  }, [controls.terminalAvailable]);

  useEffect(() => {
    if (controls.activeSurface !== "chat") return;
    setAndStoreOpenChatTabs((current) => {
      const existingIndex = current.findIndex((thread) => thread.id === currentChatTab.id);
      if (existingIndex < 0) return [...current, currentChatTab];
      const existing = current[existingIndex];
      if (
        existing?.title === currentChatTab.title &&
        existing.provider === currentChatTab.provider
      ) {
        return current;
      }
      return current.map((thread) => (thread.id === currentChatTab.id ? currentChatTab : thread));
    });
  }, [controls.activeSurface, currentChatTab, setAndStoreOpenChatTabs]);

  const chatTabs = useMemo(() => {
    const sortedProjectThreads = sortThreadsForSidebar(
      displayThreads.filter((thread) => thread.projectId === controls.projectId),
      settings.sidebarThreadSortOrder,
    );
    const sidebarThreadById = new Map(
      sortedProjectThreads.map((thread) => [
        thread.id,
        {
          id: thread.id,
          title: thread.title,
          provider: thread.session?.provider ?? thread.modelSelection.provider,
        },
      ]),
    );
    const activeChatAlreadyOpen = openChatTabs.some((thread) => thread.id === props.activeThreadId);
    const orderedOpenTabs =
      controls.activeSurface === "chat" && !activeChatAlreadyOpen
        ? [...openChatTabs, currentChatTab]
        : openChatTabs;
    return orderedOpenTabs.map((thread) => sidebarThreadById.get(thread.id) ?? thread);
  }, [
    controls.activeSurface,
    controls.projectId,
    currentChatTab,
    displayThreads,
    openChatTabs,
    props.activeThreadId,
    settings.sidebarThreadSortOrder,
  ]);
  const terminalTabVisible = terminalTabOpen || controls.terminalAvailable;
  const shouldShowTabs = chatTabs.length + (terminalTabVisible ? 1 : 0) > 1;
  const newTerminalTab = () => {
    setTerminalTabOpen(true);
    controls.onNewTerminal();
  };
  const openTerminalTab = () => {
    setTerminalTabOpen(true);
    controls.onOpenTerminal();
  };
  const closeTerminalTab = () => {
    setTerminalTabOpen(false);
    controls.onCloseTerminal();
  };
  const openChatTab = (threadId: ThreadId) => {
    const sidebarThread = displayThreads.find((thread) => thread.id === threadId);
    if (sidebarThread) {
      const nextTab = {
        id: sidebarThread.id,
        title: sidebarThread.title,
        provider: sidebarThread.session?.provider ?? sidebarThread.modelSelection.provider,
      };
      setAndStoreOpenChatTabs((current) =>
        current.some((thread) => thread.id === threadId) ? current : [...current, nextTab],
      );
    }
    controls.onOpenChat(threadId);
  };
  const closeChatTab = (threadId: ThreadId) => {
    const closingActiveChat =
      controls.activeSurface === "chat" && threadId === props.activeThreadId;
    const nextChatTab = chatTabs.find((thread) => thread.id !== threadId);
    setAndStoreOpenChatTabs((current) => current.filter((thread) => thread.id !== threadId));
    if (!closingActiveChat) return;
    if (nextChatTab) {
      controls.onOpenChat(nextChatTab.id);
      return;
    }
    if (terminalTabVisible) openTerminalTab();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
      <div className="flex shrink-0 items-center gap-0.5">
        <Menu modal={false}>
          <MenuTrigger
            render={
              <IconButton
                variant="ghost"
                size="icon-xs"
                label="New editor rail item"
                title="New"
                className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <PlusIcon className="size-3.5" />
              </IconButton>
            }
          />
          <ComposerPickerMenuPopup
            align="start"
            side="bottom"
            sideOffset={6}
            className="w-44 min-w-44"
          >
            <MenuItem onClick={controls.onNewChat}>
              <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span>New chat</span>
            </MenuItem>
            <MenuItem onClick={newTerminalTab}>
              <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span>New terminal</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
        <EditorChatHistoryMenu
          projectId={controls.projectId}
          activeThreadId={props.activeThreadId}
          onNavigateToThread={openChatTab}
        />
      </div>
      {shouldShowTabs ? (
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chatTabs.map((thread, index) => (
            <SurfaceTabChip
              key={thread.id}
              active={controls.activeSurface === "chat" && thread.id === props.activeThreadId}
              title={thread.title}
              label={`Chat ${index + 1}`}
              labelClassName="max-w-24"
              icon={
                <ProviderIcon
                  provider={thread.provider}
                  tone="header"
                  className="size-3 shrink-0"
                />
              }
              closeLabel={`Close ${thread.title}`}
              onSelect={() => openChatTab(thread.id)}
              onClose={() => closeChatTab(thread.id)}
            />
          ))}
          {terminalTabVisible ? (
            <SurfaceTabChip
              active={controls.activeSurface === "terminal"}
              title="Terminal"
              label="Terminal"
              labelClassName="max-w-24"
              icon={<TerminalIcon className="size-3 shrink-0 text-[var(--color-text-accent)]" />}
              trailing={
                controls.terminalHasRunningActivity ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
                ) : null
              }
              onSelect={openTerminalTab}
              closeLabel="Close Terminal"
              onClose={closeTerminalTab}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
