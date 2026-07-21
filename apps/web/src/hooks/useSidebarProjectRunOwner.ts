// FILE: useSidebarProjectRunOwner.ts
// Purpose: Own sidebar dev-server discovery, lifecycle, attribution, and launch dialog state.
// Layer: Web sidebar controller

import {
  ProjectId,
  type ProjectDiscoveredScriptTarget,
  type ServerLocalServerProcess,
} from "@agent-group/contracts";
import { localServerAddressLabel, localServerMatchesRun } from "@agent-group/shared/localServers";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findDeepestWorkspaceRootMatch } from "../components/Sidebar.projectRecoveryLogic";
import { toastManager } from "../components/ui/toast";
import { projectDiscoverScriptsQueryOptions } from "../lib/projectReactQuery";
import { serverQueryKeys, sidebarLocalServersQueryOptions } from "../lib/serverReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useProjectRunStore, type ProjectRunState } from "../projectRunStore";
import {
  selectPrimaryProjectRunCommand,
  upsertProjectRunCommandScripts,
} from "../projectRunTargets";
import { projectScriptRuntimeEnv } from "../projectScripts";
import type { Project } from "../types";

function firstLocalServerUrl(server: ServerLocalServerProcess): string | null {
  return server.addresses.find((address) => address.url)?.url ?? null;
}

function findTrackedProjectRunServer(
  run: ProjectRunState | null | undefined,
  servers: readonly ServerLocalServerProcess[],
): ServerLocalServerProcess | null {
  if (!run) return null;
  return servers.find((server) => localServerMatchesRun(server, run)) ?? null;
}

export interface SidebarProjectRunDialogModel {
  readonly open: boolean;
  readonly projectName: string;
  readonly commandDraft: string;
  readonly commandIsValid: boolean;
  readonly hasExistingRun: boolean;
}

interface UseSidebarProjectRunOwnerInput {
  readonly projects: readonly Project[];
}

export function useSidebarProjectRunOwner({ projects }: UseSidebarProjectRunOwnerInput) {
  const queryClient = useQueryClient();
  const runsByProjectId = useProjectRunStore((state) => state.runsByProjectId);
  const upsertRun = useProjectRunStore((state) => state.upsertRun);
  const removeRun = useProjectRunStore((state) => state.removeRun);
  const [dialogProjectId, setDialogProjectId] = useState<ProjectId | null>(null);
  const [dialogCommandDraft, setDialogCommandDraft] = useState("");
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const projectByIdRef = useRef(projectById);
  projectByIdRef.current = projectById;

  const scriptDiscoveryQueries = useQueries({
    queries: projects.map((project) =>
      projectDiscoverScriptsQueryOptions({
        cwd: project.cwd,
        enabled:
          project.kind === "project" &&
          !project.scripts.some((script) => !script.runOnWorktreeCreate),
      }),
    ),
  });
  const discoveredScriptTargetsByProjectId = useMemo(() => {
    const targetsByProjectId = new Map<ProjectId, readonly ProjectDiscoveredScriptTarget[]>();
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      if (!project) continue;
      targetsByProjectId.set(project.id, scriptDiscoveryQueries[index]?.data?.targets ?? []);
    }
    return targetsByProjectId;
  }, [projects, scriptDiscoveryQueries]);
  const commandByProjectId = useMemo(() => {
    const commands = new Map<ProjectId, ReturnType<typeof selectPrimaryProjectRunCommand>>();
    for (const project of projects) {
      commands.set(
        project.id,
        selectPrimaryProjectRunCommand({
          project,
          discoveredTargets: discoveredScriptTargetsByProjectId.get(project.id) ?? [],
        }),
      );
    }
    return commands;
  }, [discoveredScriptTargetsByProjectId, projects]);
  const commandByProjectIdRef = useRef(commandByProjectId);
  commandByProjectIdRef.current = commandByProjectId;

  const hasActiveProjectRun = useMemo(
    () => Object.keys(runsByProjectId).length > 0,
    [runsByProjectId],
  );
  const localServersQuery = useQuery(
    sidebarLocalServersQueryOptions({
      hasActiveProjectRun,
      hasProjects: projects.length > 0,
    }),
  );
  const serverByProjectId = useMemo(() => {
    const servers = localServersQuery.data?.servers ?? [];
    const result = new Map<ProjectId, ServerLocalServerProcess>();
    for (const run of Object.values(runsByProjectId)) {
      const server = findTrackedProjectRunServer(run, servers);
      if (server) result.set(run.projectId, server);
    }
    for (const server of servers) {
      if (!server.cwd) continue;
      const project = findDeepestWorkspaceRootMatch(projects, server.cwd, (item) => item.cwd);
      if (project && !result.has(project.id)) result.set(project.id, server);
    }
    return result;
  }, [localServersQuery.data?.servers, projects, runsByProjectId]);
  const serverByProjectIdRef = useRef(serverByProjectId);
  serverByProjectIdRef.current = serverByProjectId;

  const start = useCallback(
    async (projectId: ProjectId, commandOverride?: string) => {
      const api = readNativeApi();
      const project = projectByIdRef.current.get(projectId);
      const runCommand = commandByProjectIdRef.current.get(projectId);
      if (!api || !project || !runCommand || runsByProjectId[projectId]) {
        return;
      }
      const command = commandOverride?.trim() || runCommand.command;
      const env = projectScriptRuntimeEnv({
        project: { cwd: project.cwd },
        worktreePath: null,
      });
      upsertRun({
        projectId,
        command,
        cwd: runCommand.cwd,
        pid: null,
        startedAt: new Date().toISOString(),
        status: "starting",
      });
      try {
        const { server } = await api.projects.runDevServer({
          projectId,
          command,
          cwd: runCommand.cwd,
          env,
        });
        upsertRun(server);
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
      } catch (error) {
        removeRun(projectId);
        toastManager.add({
          type: "error",
          title: `Failed to run "${project.name}"`,
          description: error instanceof Error ? error.message : "Unable to start the run command.",
        });
      }
    },
    [queryClient, removeRun, runsByProjectId, upsertRun],
  );

  const stop = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      if (!api) {
        removeRun(projectId);
        return;
      }
      removeRun(projectId);
      try {
        await api.projects.stopDevServer({ projectId });
      } catch (error) {
        try {
          const { servers } = await api.projects.listDevServers();
          useProjectRunStore.getState().replaceAll(servers);
        } catch {
          // The server event stream will reconcile if this eager resync also fails.
        }
        toastManager.add({
          type: "error",
          title: "Failed to stop run",
          description: error instanceof Error ? error.message : "Unable to stop the dev server.",
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
      }
    },
    [queryClient, removeRun],
  );

  const openServer = useCallback(async (projectId: ProjectId) => {
    const api = readNativeApi();
    const server = serverByProjectIdRef.current.get(projectId);
    const url = server ? firstLocalServerUrl(server) : null;
    if (!api || !server || !url) return;
    try {
      await api.shell.openExternal(url);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Unable to open ${localServerAddressLabel(server)}`,
        description: error instanceof Error ? error.message : "Unable to open the local server.",
      });
    }
  }, []);

  const openDialog = useCallback((projectId: ProjectId) => {
    setDialogProjectId(projectId);
  }, []);
  const closeDialog = useCallback(() => setDialogProjectId(null), []);
  useEffect(() => {
    if (dialogProjectId === null) return;
    setDialogCommandDraft(commandByProjectIdRef.current.get(dialogProjectId)?.command ?? "");
  }, [dialogProjectId]);

  const persistCommand = useCallback(async (projectId: ProjectId, command: string) => {
    const api = readNativeApi();
    const project = projectByIdRef.current.get(projectId);
    if (!api || !project) return;
    const scripts = upsertProjectRunCommandScripts({ scripts: project.scripts, command });
    if (!scripts) return;
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        scripts,
      });
    } catch (error) {
      console.error("Failed to save project run command", { projectId, error });
    }
  }, []);

  const confirmDialog = useCallback(() => {
    const projectId = dialogProjectId;
    const command = dialogCommandDraft.trim();
    if (!projectId || !command) return;
    setDialogProjectId(null);
    void persistCommand(projectId, command);
    void start(projectId, command);
  }, [dialogCommandDraft, dialogProjectId, persistCommand, start]);

  const dialogProject = dialogProjectId ? (projectById.get(dialogProjectId) ?? null) : null;
  const dialogCommandIsValid = dialogCommandDraft.trim().length > 0;
  const dialog: SidebarProjectRunDialogModel = {
    open: dialogProjectId !== null,
    projectName: dialogProject?.name ?? "Project",
    commandDraft: dialogCommandDraft,
    commandIsValid: dialogCommandIsValid,
    hasExistingRun: dialogProjectId ? Boolean(runsByProjectId[dialogProjectId]) : false,
  };

  return {
    dialog,
    runsByProjectId,
    serverByProjectId,
    canOpenServer: (projectId: ProjectId) => {
      const server = serverByProjectId.get(projectId);
      return server ? firstLocalServerUrl(server) !== null : false;
    },
    setDialogCommandDraft,
    openDialog,
    closeDialog,
    confirmDialog,
    start,
    stop,
    openServer,
  };
}
