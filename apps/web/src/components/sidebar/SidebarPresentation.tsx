// FILE: SidebarPresentation.tsx
// Purpose: Compose the sidebar chrome, product surfaces, rows, and overlays from one controller.
// Layer: Web sidebar presentation

import { ClockIcon, KanbanIcon, NewThreadIcon, SearchIcon, TerminalIcon } from "~/lib/icons";
import { IoIosGitCompare } from "react-icons/io";
import { resolveSidebarNewThreadEnvMode } from "../Sidebar.logic";
import { SidebarPinnedThreadRow } from "./SidebarPinnedThreadRow";
import { SidebarProjectRow } from "./SidebarProjectRow";
import { SidebarThreadRow } from "./SidebarThreadRow";
import { SidebarWorkspaceSection } from "./SidebarWorkspaceSection";
import {
  SidebarPrimaryAction,
  SidebarSegmentedPicker,
  type SortableProjectHandleProps,
} from "./SidebarControls";
import { SidebarChatsSection } from "./SidebarChatsSection";
import { SidebarChrome } from "./SidebarChrome";
import { SidebarOverlays } from "./SidebarOverlays";
import { SidebarProjectsSurface } from "./SidebarProjectsSurface";
import { SidebarStudioSurface } from "./SidebarStudioSurface";
import { SidebarPinnedThreadsSection } from "./SidebarSurfaceShared";
import { SidebarGroup, SidebarMenu } from "../ui/sidebar";
import type { SidebarController } from "./useSidebarController";

export function SidebarPresentation({ controller }: { controller: SidebarController }) {
  const { shell, settings, surface, owners, data, actions, keyboard, runDialog } = controller;
  const { appSettings, updateSettings } = settings;
  const {
    workspaceOwner,
    surfaceNavigation,
    projectAccess,
    projectMenu,
    projectList,
    threadInteraction,
    threadRowsOwner,
  } = owners;
  const pinnedThreadsSection = (
    <SidebarPinnedThreadsSection
      threads={data.pinnedThreads}
      renderThread={(thread) => (
        <SidebarPinnedThreadRow key={thread.id} thread={thread} owner={threadRowsOwner} />
      )}
    />
  );

  function renderChatItem(row: (typeof data.visibleChatThreadRows)[number]) {
    return (
      <SidebarThreadRow
        key={row.thread.id}
        row={{
          thread: row.thread,
          orderedThreadIds: data.visibleChatThreadIds,
          depth: row.depth,
          childCount: row.childCount,
          isExpanded: row.isExpanded,
          topLevel: true,
        }}
        owner={threadRowsOwner}
      />
    );
  }

  function renderStudioChatItem(row: (typeof data.studioChatThreadRows)[number]) {
    return (
      <SidebarThreadRow
        key={row.thread.id}
        row={{
          thread: row.thread,
          orderedThreadIds: data.studioChatThreadIds,
          depth: row.depth,
          childCount: row.childCount,
          isExpanded: row.isExpanded,
          topLevel: true,
        }}
        owner={threadRowsOwner}
      />
    );
  }

  function renderProjectItem(
    project: (typeof data.standardProjects)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const projectData = data.surfaceProjectSidebarDataById.get(project.id);
    if (!projectData) return null;
    const projectRun = data.projectRunsByProjectId[project.id] ?? null;
    const projectRunServer = data.projectRunServerByProjectId.get(project.id) ?? null;
    return (
      <SidebarProjectRow
        model={{
          project,
          data: projectData,
          presentation: {
            homeDir: data.homeDir,
            pinned: data.pinnedProjectIdSet.has(project.id),
            running: projectRun !== null || projectRunServer !== null,
            manualSorting: projectList.model.manualSorting,
            newThreadShortcutLabel: keyboard.newThreadShortcutLabel,
            newTerminalThreadShortcutLabel: keyboard.newTerminalThreadShortcutLabel,
          },
        }}
        actions={{
          header: {
            pointerDownCapture: projectList.actions.titlePointerDownCapture,
            click: projectList.actions.titleClick,
            keyDown: projectList.actions.titleKeyDown,
            openContextMenu: (projectId, position) => {
              void projectMenu.actions.openContextMenu(projectId, position);
            },
          },
          project: {
            togglePinned: actions.toggleProjectPinned,
            edit: (projectId) => void projectMenu.actions.runAction(projectId, "rename"),
            openPullRequests: (projectId) => {
              void actions.navigate({
                to: "/pull-requests",
                search: { involvement: "all", state: "open", projectId },
              });
            },
            createThread: (projectId, entryPoint) => {
              void actions.handleNewThread(projectId, {
                envMode: resolveSidebarNewThreadEnvMode({
                  defaultEnvMode: appSettings.defaultThreadEnvMode,
                }),
                ...(entryPoint === "terminal" ? { entryPoint: "terminal" as const } : {}),
              });
            },
          },
          paging: {
            showMore: actions.showMoreThreadsForProject,
            showLess: actions.showLessThreadsForProject,
          },
        }}
        dragHandleProps={dragHandleProps}
        renderThreadRow={(entry, orderedProjectThreadIds) => (
          <SidebarThreadRow
            key={entry.thread.id}
            row={{
              thread: entry.thread,
              orderedThreadIds: orderedProjectThreadIds,
              depth: entry.depth,
              childCount: entry.childCount,
              isExpanded: entry.isExpanded,
            }}
            owner={threadRowsOwner}
          />
        )}
      />
    );
  }

  return (
    <>
      <SidebarChrome
        model={{
          isOnSettings: shell.isOnSettings,
          activeSettingsSection: shell.activeSettingsSection,
          showDebugFeatureFlagsMenu: shell.showDebugFeatureFlagsMenu,
        }}
        actions={{ backFromSettings: surfaceNavigation.backFromSettings }}
        desktopUpdate={shell.desktopUpdate}
      >
        <SidebarSegmentedPicker
          views={[
            ...(surface.studioSectionVisible ? (["studio"] as const) : []),
            "threads",
            ...(surface.workspaceSectionVisible ? (["workspace"] as const) : []),
          ]}
          activeView={
            surface.isOnStudio ? "studio" : surface.isOnWorkspace ? "workspace" : "threads"
          }
          onSelectView={surfaceNavigation.selectView}
          onPrewarmView={surfaceNavigation.prewarmView}
        />
        <div
          key={surface.isOnWorkspace ? "workspace" : surface.isOnStudio ? "studio" : "threads"}
          className="sidebar-surface-enter"
        >
          <SidebarGroup className="px-1.5 pt-1 pb-1.5">
            <SidebarMenu className="gap-0.5">
              {surface.isOnWorkspace ? (
                <SidebarPrimaryAction
                  icon={TerminalIcon}
                  label="New workspace"
                  onClick={workspaceOwner.actions.create}
                />
              ) : surface.isOnStudio ? (
                <>
                  <SidebarPrimaryAction
                    icon={NewThreadIcon}
                    label="New studio chat"
                    onClick={surfaceNavigation.createStudioChat}
                  />
                  <SidebarPrimaryAction
                    icon={SearchIcon}
                    label="Search"
                    active={keyboard.searchPaletteOpen}
                    onClick={keyboard.openSearchPalette}
                    shortcutLabel={keyboard.searchShortcutLabel}
                  />
                </>
              ) : (
                <>
                  <SidebarPrimaryAction
                    icon={NewThreadIcon}
                    label="New thread"
                    onClick={projectAccess.actions.createPrimaryThread}
                  />
                  <SidebarPrimaryAction
                    icon={SearchIcon}
                    label="Search"
                    active={keyboard.searchPaletteOpen}
                    onClick={keyboard.openSearchPalette}
                    shortcutLabel={keyboard.searchShortcutLabel}
                  />
                  <SidebarPrimaryAction
                    icon={KanbanIcon}
                    label="Kanban"
                    active={surface.isOnKanban}
                    onClick={() => void actions.navigate({ to: "/kanban" })}
                  />
                  <SidebarPrimaryAction
                    icon={IoIosGitCompare}
                    label="Pull requests"
                    active={surface.isOnPullRequests}
                    badge={surface.pullRequestsReviewBadge}
                    onClick={() =>
                      void actions.navigate({
                        to: "/pull-requests",
                        search: { involvement: "all", state: "open" },
                      })
                    }
                  />
                  <SidebarPrimaryAction
                    icon={ClockIcon}
                    label="Automations"
                    active={surface.isOnAutomations}
                    badge={surface.automationAttentionBadge}
                    onClick={() => void actions.navigate({ to: "/automations" })}
                  />
                </>
              )}
            </SidebarMenu>
          </SidebarGroup>

          {surface.isOnWorkspace ? (
            <SidebarWorkspaceSection owner={workspaceOwner} sensors={projectList.model.sensors} />
          ) : surface.isOnStudio ? (
            <SidebarStudioSurface
              model={{
                rows: data.studioChatThreadRows,
                threadsHydrated: data.threadsHydrated,
                threadSortOrder: appSettings.sidebarThreadSortOrder,
                attachAutoAnimateRef: projectList.model.attachAutoAnimateRef,
              }}
              actions={{
                createChat: surfaceNavigation.createStudioChat,
                changeThreadSort: (sortOrder) =>
                  updateSettings({ sidebarThreadSortOrder: sortOrder }),
              }}
              slots={{ pinnedThreads: pinnedThreadsSection, renderThread: renderStudioChatItem }}
            />
          ) : (
            <SidebarProjectsSurface
              model={{
                projects: data.standardProjects,
                emptyState: data.projectEmptyState,
                allExpanded: data.allProjectsExpanded,
                focusedProjectId: data.focusedProjectId,
                addProjectOpen: projectAccess.model.open,
                sorting: {
                  project: appSettings.sidebarProjectSortOrder,
                  thread: appSettings.sidebarThreadSortOrder,
                  manual: projectList.model.manualSorting,
                },
                drag: {
                  sensors: projectList.model.sensors,
                  collisionDetection: projectList.model.collisionDetection,
                  attachAutoAnimateRef: projectList.model.attachAutoAnimateRef,
                },
              }}
              actions={{
                toggleAll: projectList.actions.toggleAll,
                toggleAddProject: projectAccess.actions.toggle,
                changeProjectSort: (sortOrder) =>
                  updateSettings({ sidebarProjectSortOrder: sortOrder }),
                changeThreadSort: (sortOrder) =>
                  updateSettings({ sidebarThreadSortOrder: sortOrder }),
                drag: {
                  start: projectList.actions.dragStart,
                  end: projectList.actions.dragEnd,
                  cancel: projectList.actions.dragCancel,
                },
              }}
              slots={{
                pinnedThreads: pinnedThreadsSection,
                projectAccessOwner: projectAccess,
                renderProject: renderProjectItem,
              }}
            />
          )}
        </div>

        {!surface.isOnStudio && surface.chatsSectionVisible ? (
          <SidebarChatsSection
            model={{
              open: surface.chatSectionExpanded,
              hasAnyRows: data.visibleChatThreadRows.length > 0,
              threadSortOrder: appSettings.sidebarThreadSortOrder,
              newChatShortcutLabel: keyboard.newChatShortcutLabel,
              paging: {
                canShowMore: data.canShowMoreChatThreads,
                canShowLess: data.canShowLessChatThreads,
                effectiveExtraPages: data.chatThreadListEffectiveExtraPages,
              },
            }}
            actions={{
              toggle: actions.toggleChatSection,
              createChat: surfaceNavigation.createHomeChat,
              changeThreadSort: (sortOrder) =>
                updateSettings({ sidebarThreadSortOrder: sortOrder }),
              showMore: actions.showMoreChatThreads,
              showLess: actions.showLessChatThreads,
            }}
            slots={{
              renderRows: () => data.renderedChatEntries.map((entry) => renderChatItem(entry.row)),
            }}
          />
        ) : null}
      </SidebarChrome>

      <SidebarOverlays
        project={{
          menuOwner: projectMenu,
          accessOwner: projectAccess,
          byId: data.projectById,
          run: {
            model: runDialog.projectRunDialog,
            actions: {
              close: runDialog.closeProjectRunDialog,
              setCommand: runDialog.setProjectRunDialogCommandDraft,
              confirm: runDialog.handleConfirmProjectRun,
            },
          },
        }}
        thread={{
          interactionOwner: threadInteraction,
          summaryById: data.sidebarThreadSummaryById,
          importFromProvider: actions.handleImportThread,
        }}
        palette={{
          model: {
            open: keyboard.searchPaletteOpen,
            mode: keyboard.searchPaletteMode,
            initialBrowseQuery: keyboard.searchPaletteInitialQuery,
            actions: keyboard.searchPaletteActions,
            projects: keyboard.searchPaletteProjects,
            homeDir: data.homeDir,
          },
          actions: {
            setMode: keyboard.setSearchPaletteMode,
            setOpen: keyboard.handleSearchPaletteOpenChange,
          },
        }}
        surface={{
          model: { isOnStudio: surface.isOnStudio },
          actions: {
            createStudioChat: surfaceNavigation.createStudioChat,
            createHomeChat: surfaceNavigation.createHomeChat,
          },
        }}
      />
    </>
  );
}
