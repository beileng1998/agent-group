// FILE: useProjectScriptController.ts
// Purpose: Own project action execution, persistence, shortcuts, and recent selection.
// Layer: Web project action controller

import { type ProjectScript, type ThreadId } from "@agent-group/contracts";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { isElectron } from "../env";
import { decodeProjectScriptKeybindingRule } from "../lib/projectScriptKeybindings";
import { useLocalStorage } from "./useLocalStorage";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { runProjectCommandInTerminal } from "../projectTerminalRunner";
import {
  commandForProjectScript,
  nextProjectScriptId,
  type ProjectScriptRunOptions,
  type ProjectScriptRunResult,
} from "../projectScripts";
import { serverQueryKeys } from "../lib/serverReactQuery";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { randomTerminalId } from "../components/terminal/terminalId";
import { resolveProjectScriptTerminalTarget } from "../components/ChatView.logic";
import {
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
} from "../components/ChatView.dispatch";
import type { NewProjectScriptInput } from "../components/ProjectScriptsControl";
import { toastManager } from "../components/ui/toast";
import { DEFAULT_THREAD_TERMINAL_ID, type Project, type Thread } from "../types";

interface UseProjectScriptControllerOptions {
  activeThreadId: ThreadId | null;
  project: Project | null;
  requestTerminalFocus: () => void;
  routeThreadId: ThreadId;
  setThreadError: (threadId: ThreadId, message: string | null) => void;
  thread: Thread | null;
  workingDirectory: string | null;
}

export function useProjectScriptController(options: UseProjectScriptControllerOptions) {
  const {
    activeThreadId,
    project,
    requestTerminalFocus,
    routeThreadId,
    setThreadError,
    thread,
    workingDirectory,
  } = options;
  const queryClient = useQueryClient();
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId),
  );
  const setTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const setActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const createTerminal = useTerminalStateStore((state) => state.newTerminal);
  const setTerminalMetadata = useTerminalStateStore((state) => state.setTerminalMetadata);
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      runOptions?: ProjectScriptRunOptions,
    ): Promise<ProjectScriptRunResult | null> => {
      const api = readNativeApi();
      if (!api || !activeThreadId || !project || !thread) return null;

      if (runOptions?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[project.id] === script.id) return current;
          return { ...current, [project.id]: script.id };
        });
      }
      const targetCwd = runOptions?.cwd ?? workingDirectory ?? project.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const { shouldCreateNewTerminal, terminalId } = resolveProjectScriptTerminalTarget({
        baseTerminalId,
        createTerminalId: randomTerminalId,
        hasRunningTerminal: terminalState.runningTerminalIds.length > 0,
        preferNewTerminal: runOptions?.preferNewTerminal,
        terminalOpen: terminalState.terminalOpen,
      });

      setTerminalOpen(activeThreadId, true);
      if (shouldCreateNewTerminal) {
        createTerminal(activeThreadId, terminalId);
      } else {
        setActiveTerminal(activeThreadId, terminalId);
      }
      requestTerminalFocus();

      try {
        const { metadata } = await runProjectCommandInTerminal({
          api,
          threadId: activeThreadId,
          terminalId,
          project: { cwd: project.cwd },
          cwd: targetCwd,
          command: script.command,
          worktreePath: runOptions?.worktreePath ?? thread.worktreePath ?? null,
          ...(runOptions?.env ? { env: runOptions.env } : {}),
        });
        if (metadata) {
          setTerminalMetadata(activeThreadId, terminalId, {
            cliKind: metadata.cliKind,
            label: metadata.label,
          });
        }
        return { terminalId };
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
        if (runOptions?.throwOnError) {
          throw error instanceof Error
            ? error
            : new Error(`Failed to run script "${script.name}".`);
        }
        return null;
      }
    },
    [
      activeThreadId,
      createTerminal,
      project,
      requestTerminalFocus,
      setActiveTerminal,
      setLastInvokedScriptByProjectId,
      setTerminalMetadata,
      setTerminalOpen,
      setThreadError,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
      terminalState.terminalOpen,
      thread,
      workingDirectory,
    ],
  );

  const persistScripts = useCallback(
    async (
      nextScripts: ProjectScript[],
      keybinding: string | null | undefined,
      keybindingCommand: ReturnType<typeof commandForProjectScript>,
    ) => {
      if (!project) return;
      const api = readNativeApi();
      if (!api) return;

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: project.id,
        scripts: nextScripts,
      });
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: keybindingCommand,
      });
      if (isElectron && keybindingRule) {
        await api.server.upsertKeybinding(keybindingRule);
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.all });
      }
    },
    [project, queryClient],
  );

  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!project) return;
      const nextId = nextProjectScriptId(
        input.name,
        project.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...project.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...project.scripts, nextScript];
      await persistScripts(nextScripts, input.keybinding, commandForProjectScript(nextId));
    },
    [persistScripts, project],
  );

  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!project) return;
      const existingScript = project.scripts.find((script) => script.id === scriptId);
      if (!existingScript) throw new Error("Script not found.");

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = project.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );
      await persistScripts(nextScripts, input.keybinding, commandForProjectScript(scriptId));
    },
    [persistScripts, project],
  );

  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!project) return;
      const nextScripts = project.scripts.filter((script) => script.id !== scriptId);
      const deletedName = project.scripts.find((script) => script.id === scriptId)?.name;
      try {
        await persistScripts(nextScripts, null, commandForProjectScript(scriptId));
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [persistScripts, project],
  );

  return {
    deleteProjectScript,
    lastInvokedScriptId: project ? (lastInvokedScriptByProjectId[project.id] ?? null) : null,
    runProjectScript,
    saveProjectScript,
    updateProjectScript,
  };
}
