import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAgentGroupSession } from "~/agentGroupCapabilities";
import { useGroupSettingsStore } from "~/groupSettingsStore";
import { renameAgentGroupProject } from "~/lib/agentGroupProjects";
import { createOrRecoverProjectFromPath } from "~/lib/projectCreation";
import { serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { dispatchThreadRename } from "~/lib/threadRename";
import { newCommandId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";
import type { Project, SidebarThreadSummary } from "~/types";
import { normalizeSettingsSection, type SettingsSectionId } from "~/settingsNavigation";
import { AgentGroupCreateForm } from "./AgentGroupCreateForm";
import { AgentGroupSidebarFooter } from "./AgentGroupSidebarFooter";
import { AgentGroupSidebarGroups } from "./AgentGroupSidebarGroups";
import { AgentGroupSidebarHeader } from "./AgentGroupSidebarHeader";
import {
  resolveNewAgentGroupSessionDefaults,
  selectAgentGroupProjects,
  selectAgentGroupSessions,
} from "./AgentGroupSidebar.logic";
import { AgentGroupSidebarDialogs } from "./AgentGroupSidebarDialogs";
import { useAgentGroupSidebarDisclosure } from "./AgentGroupSidebarDisclosure";
import { useAgentGroupSidebarOrder } from "./AgentGroupSidebarOrder";
import { useAgentGroupShellNavigation } from "./AgentGroupShellNavigation";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { useSidebar } from "./ui/sidebar";
import { toastManager } from "./ui/toast";
import { useAgentGroupSidebarManagement } from "./useAgentGroupSidebarManagement";

export default function AgentGroupSidebar() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { openSearch, searchOpen } = useAgentGroupShellNavigation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeSearch = useLocation({ select: (location) => location.search });
  const projects = useStore((state) => state.projects);
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const threadSummaries = useStore((state) => state.sidebarThreadSummaryById);
  const candidateThreadId = pathname.match(/^\/([^/]+)$/)?.[1] ?? null;
  const activeThreadId =
    candidateThreadId && threadSummaries[candidateThreadId] ? candidateThreadId : null;
  const isOnSettings = pathname === "/settings";
  const activeSettingsSection = normalizeSettingsSection(
    (routeSearch as { section?: unknown }).section,
  );
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const setProjectExpanded = useStore((state) => state.setProjectExpanded);
  const {
    forgetGroup,
    forgetSession: forgetOrderedSession,
    orderSessions,
    reorderSessions,
  } = useAgentGroupSidebarOrder();
  const { collapsedSessionIds, forgetCollapsedSession, setCollapsedSessionIds } =
    useAgentGroupSidebarDisclosure();
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingSessionKey, setCreatingSessionKey] = useState<string | null>(null);
  const creatingSessionRef = useRef<string | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<ProjectId | null>(null);
  const [renameSessionId, setRenameSessionId] = useState<ThreadId | null>(null);
  const lastActiveThreadIdRef = useRef<ThreadId | null>(null);
  const threadSummariesRef = useRef(threadSummaries);
  threadSummariesRef.current = threadSummaries;

  const groups = useMemo(() => selectAgentGroupProjects(projects), [projects]);
  const sessions = useMemo(() => selectAgentGroupSessions(threadSummaries), [threadSummaries]);
  const sessionsByGroup = useMemo(() => {
    const result = new Map<ProjectId, SidebarThreadSummary[]>();
    for (const thread of sessions) {
      const current = result.get(thread.projectId) ?? [];
      current.push(thread);
      result.set(thread.projectId, current);
    }
    for (const [projectId, sessions] of result) {
      result.set(projectId, orderSessions(projectId, sessions));
    }
    return result;
  }, [orderSessions, sessions]);
  const activeSession = activeThreadId ? threadSummaries[activeThreadId] : undefined;
  const activeGroupId = activeSession?.projectId ?? null;

  useEffect(() => {
    if (activeGroupId) setProjectExpanded(activeGroupId, true);
  }, [activeGroupId, setProjectExpanded]);

  useEffect(() => {
    if (activeThreadId) lastActiveThreadIdRef.current = activeThreadId as ThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    const ancestorIds = new Set<string>();
    const summaries = threadSummariesRef.current;
    let parentId = summaries[activeThreadId]?.parentThreadId ?? null;
    while (parentId && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId);
      parentId = summaries[parentId]?.parentThreadId ?? null;
    }
    if (ancestorIds.size === 0) return;
    setCollapsedSessionIds((current) => {
      if (![...ancestorIds].some((threadId) => current.has(threadId))) return current;
      const next = new Set(current);
      for (const threadId of ancestorIds) next.delete(threadId);
      return next;
    });
  }, [activeThreadId]);

  const navigateThread = useCallback(
    (threadId: ThreadId) => {
      if (isMobile) setOpenMobile(false);
      void navigate({ to: "/$threadId", params: { threadId } });
    },
    [isMobile, navigate, setOpenMobile],
  );

  const openThread = useCallback(
    (threadId: ThreadId) => navigateThread(threadId),
    [navigateThread],
  );

  const forgetSession = useCallback(
    (groupId: ProjectId, sessionId: ThreadId) => {
      forgetOrderedSession(groupId, sessionId);
      forgetCollapsedSession(sessionId);
    },
    [forgetCollapsedSession, forgetOrderedSession],
  );

  const {
    deleteGroup,
    deleteSession,
    reorderGroup,
    reorderSession,
    toggleGroupPin,
    toggleSessionPin,
  } = useAgentGroupSidebarManagement({
    activeGroupId,
    activeThreadId,
    forgetGroup,
    forgetSession,
    groups,
    navigateThread,
    reorderSessions,
    sessionsByGroup,
    threadSummaries,
  });

  const createSession = useCallback(
    async (project: Project, parent: SidebarThreadSummary | null = null) => {
      const sessionKey = `${project.id}:${parent?.id ?? "root"}`;
      if (creatingSessionRef.current) return null;
      const api = readNativeApi();
      if (!api) throw new Error("The Agent Group service is unavailable.");
      creatingSessionRef.current = sessionKey;
      setCreatingSessionKey(sessionKey);
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const defaults = resolveNewAgentGroupSessionDefaults(
        project,
        parent,
        serverSettingsQuery.data?.agentGroup.defaultModelSelection,
      );
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: project.id,
          title: defaults.title,
          modelSelection: defaults.modelSelection,
          runtimeMode: "full-access",
          interactionMode: defaults.interactionMode,
          envMode: defaults.envMode,
          branch: null,
          worktreePath: null,
          parentThreadId: defaults.parentThreadId,
          createdAt,
        });
        const snapshot = await api.orchestration.getShellSnapshot();
        syncServerShellSnapshot(snapshot);
        setProjectExpanded(project.id, true);
        navigateThread(threadId);
        return threadId;
      } finally {
        creatingSessionRef.current = null;
        setCreatingSessionKey(null);
      }
    },
    [
      navigateThread,
      serverSettingsQuery.data?.agentGroup.defaultModelSelection,
      setProjectExpanded,
      syncServerShellSnapshot,
    ],
  );

  const createGroup = useCallback(
    async (rawPath: string, rawName: string) => {
      const workspaceRoot = rawPath.trim();
      const title = rawName.trim();
      const api = readNativeApi();
      if (!workspaceRoot || !api || busy) return;
      setBusy(true);
      try {
        const result = await createOrRecoverProjectFromPath({
          api,
          workspaceRoot,
          ...(title ? { title } : {}),
          createIfMissing: true,
          // Agent Groups inherit the global default until the Group explicitly overrides it.
          defaultModelSelection: null,
          loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
        });
        const snapshot =
          !result.created && title
            ? await renameAgentGroupProject({ api, projectId: result.projectId, title })
            : result.snapshot;
        if (snapshot) syncServerShellSnapshot(snapshot);
        const project =
          useStore.getState().projects.find((candidate) => candidate.id === result.projectId) ??
          ({
            id: result.projectId,
            cwd: workspaceRoot,
            defaultModelSelection: result.project?.defaultModelSelection ?? null,
          } as Project);
        setProjectExpanded(project.id, true);
        const existing = snapshot?.threads
          .filter((thread) => thread.projectId === result.projectId && isAgentGroupSession(thread))
          .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        setFolderPath("");
        setGroupName("");
        setAddGroupOpen(false);
        if (existing) await openThread(existing.id);
        else await createSession(project);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not create group",
          description: error instanceof Error ? error.message : "The group could not be created.",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, createSession, openThread, setProjectExpanded, syncServerShellSnapshot],
  );

  const pickFolder = useCallback(async () => {
    try {
      const picked = await readNativeApi()?.dialogs.pickFolder();
      if (picked) setFolderPath(picked);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open folder picker",
        description: error instanceof Error ? error.message : "The folder picker could not open.",
      });
    }
  }, []);

  const handleCreateSession = useCallback(
    async (group: Project, parent: SidebarThreadSummary | null = null) => {
      try {
        return await createSession(group, parent);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: parent ? "Could not create child session" : "Could not create session",
          description: error instanceof Error ? error.message : undefined,
        });
        return null;
      }
    },
    [createSession],
  );

  const openGroupSettings = useCallback(
    (group: Project) => {
      if (isMobile) setOpenMobile(false);
      useGroupSettingsStore.getState().open(group.id);
    },
    [isMobile, setOpenMobile],
  );

  const openSessionInspector = useCallback(
    (session: SidebarThreadSummary) => {
      openThread(session.id);
      useRightDockStore.getState().openPane(session.id, {
        paneId: `context:${session.id}`,
        kind: "context",
      });
    },
    [openThread],
  );

  const renameGroup = useCallback(
    async (group: Project, title: string) => {
      const api = readNativeApi();
      if (!api) throw new Error("The Agent Group service is unavailable.");
      try {
        syncServerShellSnapshot(await renameAgentGroupProject({ api, projectId: group.id, title }));
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not rename group",
          description: error instanceof Error ? error.message : undefined,
        });
        throw error;
      }
    },
    [syncServerShellSnapshot],
  );

  const renameSession = useCallback(
    async (session: SidebarThreadSummary, title: string) => {
      try {
        await dispatchThreadRename({
          threadId: session.id,
          newTitle: title,
          unchangedTitles: [session.title],
        });
        const api = readNativeApi();
        if (api) syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not rename session",
          description: error instanceof Error ? error.message : undefined,
        });
        throw error;
      }
    },
    [syncServerShellSnapshot],
  );

  const toggleSessionCollapsed = useCallback((threadId: ThreadId) => {
    setCollapsedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const closeGroupCreator = useCallback(() => {
    setAddGroupOpen(false);
    setFolderPath("");
    setGroupName("");
  }, []);

  const backToApp = useCallback(() => {
    const previousThreadId = lastActiveThreadIdRef.current;
    if (previousThreadId && threadSummaries[previousThreadId]) {
      navigateThread(previousThreadId);
      return;
    }
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/" });
  }, [isMobile, navigate, navigateThread, setOpenMobile, threadSummaries]);

  const selectSettingsSection = useCallback(
    (section: SettingsSectionId, options?: { target?: string }) => {
      if (isMobile) setOpenMobile(false);
      void navigate({
        to: "/settings",
        search: {
          section: section === "appearance" ? undefined : section,
          target: options?.target,
        },
      });
    },
    [isMobile, navigate, setOpenMobile],
  );

  const renamingGroup = renameGroupId
    ? (groups.find((group) => group.id === renameGroupId) ?? null)
    : null;
  const renamingSession = renameSessionId ? (threadSummaries[renameSessionId] ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isOnSettings ? (
        <>
          <AgentGroupSidebarHeader mode="settings" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SettingsSidebarNav
              activeSection={activeSettingsSection}
              onBack={backToApp}
              onSelectSection={selectSettingsSection}
            />
          </div>
        </>
      ) : (
        <>
          <AgentGroupSidebarHeader
            mode="groups"
            addGroupOpen={addGroupOpen}
            searchOpen={searchOpen}
            onOpenSearch={openSearch}
            onToggleAddGroup={() => setAddGroupOpen((open) => !open)}
          />

          <AgentGroupCreateForm
            open={addGroupOpen}
            busy={busy}
            groupName={groupName}
            folderPath={folderPath}
            onGroupNameChange={setGroupName}
            onFolderPathChange={setFolderPath}
            onChooseFolder={() => void pickFolder()}
            onClose={closeGroupCreator}
            onCreate={() => void createGroup(folderPath, groupName)}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Groups
            </div>
            <AgentGroupSidebarGroups
              state={{
                activeGroupId,
                activeThreadId,
                collapsedSessionIds,
                creatingSessionKey,
                filtering: false,
              }}
              data={{
                groups,
                sessionsByGroup,
              }}
              groupActions={{
                create: () => setAddGroupOpen(true),
                delete: (group) => void deleteGroup(group),
                openSettings: openGroupSettings,
                rename: (group) => setRenameGroupId(group.id),
                reorder: reorderGroup,
                toggleExpanded: (group) => setProjectExpanded(group.id, !group.expanded),
                togglePin: (group) => void toggleGroupPin(group),
              }}
              sessionActions={{
                create: (group, parent) => void handleCreateSession(group, parent),
                delete: (session) => void deleteSession(session),
                open: openThread,
                openInspector: openSessionInspector,
                rename: (session) => setRenameSessionId(session.id),
                reorder: reorderSession,
                toggleCollapsed: toggleSessionCollapsed,
                togglePin: (session) => void toggleSessionPin(session),
              }}
            />
          </div>

          <AgentGroupSidebarFooter
            onOpenSettings={() => selectSettingsSection("appearance")}
            onOpenAppearance={() => selectSettingsSection("appearance")}
            {...(activeSession
              ? { onOpenSessionInspector: () => openSessionInspector(activeSession) }
              : {})}
          />

          <AgentGroupSidebarDialogs
            renamingGroup={renamingGroup}
            renamingSession={renamingSession}
            onCloseGroupRename={() => setRenameGroupId(null)}
            onCloseSessionRename={() => setRenameSessionId(null)}
            onRenameGroup={renameGroup}
            onRenameSession={renameSession}
          />
        </>
      )}
    </div>
  );
}
