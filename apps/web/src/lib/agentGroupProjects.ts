import type { NativeApi, OrchestrationShellSnapshot, ProjectId } from "@agent-group/contracts";

import { newCommandId } from "./utils";

export async function renameAgentGroupProject(input: {
  api: NativeApi;
  projectId: ProjectId;
  title: string;
}): Promise<OrchestrationShellSnapshot> {
  const title = input.title.trim();
  if (!title) throw new Error("Group name is empty.");
  await input.api.orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.projectId,
    title,
  });
  return input.api.orchestration.getShellSnapshot();
}
