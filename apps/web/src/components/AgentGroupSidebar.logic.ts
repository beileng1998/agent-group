import type { ModelSelection } from "@agent-group/contracts";
import { getDefaultModel } from "@agent-group/shared/model";

import { isAgentGroupSession } from "~/agentGroupCapabilities";
import type { Project, SidebarThreadSummary } from "~/types";

export function agentGroupDisplayTitle(project: Pick<Project, "name" | "remoteName">): string {
  return project.remoteName || project.name;
}

export function selectAgentGroupProjects(projects: readonly Project[]): Project[] {
  return projects
    .filter((project) => project.kind === "project")
    .toSorted((left, right) => Number(right.isPinned === true) - Number(left.isPinned === true));
}

export function selectAgentGroupSessions(
  threadSummaries: Readonly<Record<string, SidebarThreadSummary | undefined>>,
): SidebarThreadSummary[] {
  return Object.values(threadSummaries).filter((thread): thread is SidebarThreadSummary =>
    Boolean(thread && isAgentGroupSession(thread)),
  );
}

export function resolveNewAgentGroupSessionDefaults(
  project: Pick<Project, "defaultModelSelection">,
  parent: Pick<SidebarThreadSummary, "id" | "interactionMode" | "modelSelection"> | null,
  globalDefaultModelSelection?: ModelSelection,
) {
  return {
    title: parent ? "New child session" : "New session",
    modelSelection: parent?.modelSelection ??
      project.defaultModelSelection ??
      globalDefaultModelSelection ?? {
        provider: "codex" as const,
        model: getDefaultModel("codex"),
      },
    interactionMode: parent?.interactionMode ?? ("default" as const),
    envMode: "local" as const,
    parentThreadId: parent?.id ?? null,
  };
}
