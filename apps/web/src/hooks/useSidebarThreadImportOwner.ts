// FILE: useSidebarThreadImportOwner.ts
// Purpose: Own imported-thread creation, provider defaults, navigation, and rollback.
// Layer: Web sidebar controller

import { getDefaultModel } from "@agent-group/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { AppSettings } from "../appSettings";
import type { ImportProviderKind } from "../components/SidebarSearchPalette";
import { resolveSidebarNewThreadEnvMode } from "../components/Sidebar.logic";
import { newCommandId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { Project } from "../types";

interface UseSidebarThreadImportOwnerInput {
  readonly targetProject: Project | null;
  readonly defaultEnvMode: AppSettings["defaultThreadEnvMode"];
}

function importTitle(provider: ImportProviderKind, externalId: string): string {
  const suffix = externalId.slice(-8);
  const qualifier = suffix ? ` ${suffix}` : "";
  switch (provider) {
    case "claudeAgent":
      return `Imported Claude session${qualifier}`;
    case "cursor":
      return `Imported Cursor session${qualifier}`;
    case "kilo":
      return `Imported Kilo session${qualifier}`;
    case "opencode":
      return `Imported OpenCode session${qualifier}`;
    default:
      return `Imported Codex thread${qualifier}`;
  }
}

export function useSidebarThreadImportOwner({
  targetProject,
  defaultEnvMode,
}: UseSidebarThreadImportOwnerInput) {
  const navigate = useNavigate();
  const importThread = useCallback(
    async (provider: ImportProviderKind, externalId: string) => {
      const api = readNativeApi();
      if (!api) throw new Error("The app server is unavailable.");
      if (!targetProject) throw new Error("Add a project before importing a thread.");

      const providerDefaultModel = getDefaultModel(provider);
      const modelSelection =
        targetProject.defaultModelSelection?.provider === provider
          ? targetProject.defaultModelSelection
          : providerDefaultModel
            ? { provider, model: providerDefaultModel }
            : null;
      if (!modelSelection) throw new Error("Select a Pi model before importing a Pi thread.");

      const threadId = newThreadId();
      const trimmedExternalId = externalId.trim();
      let createdThread = false;
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: targetProject.id,
          title: importTitle(provider, trimmedExternalId),
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: resolveSidebarNewThreadEnvMode({ defaultEnvMode }),
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        });
        createdThread = true;
        await api.orchestration.importThread({ threadId, externalId: trimmedExternalId });
        await navigate({ to: "/$threadId", params: { threadId } });
      } catch (cause) {
        if (createdThread) {
          await api.orchestration
            .dispatchCommand({ type: "thread.delete", commandId: newCommandId(), threadId })
            .catch(() => undefined);
        }
        throw cause;
      }
    },
    [defaultEnvMode, navigate, targetProject],
  );

  return { importThread };
}
