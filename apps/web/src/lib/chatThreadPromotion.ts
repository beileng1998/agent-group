// FILE: chatThreadPromotion.ts
// Purpose: Promote a local draft thread and seed its inherited project context.
// Layer: Web send orchestration

import { type NativeApi, type ProjectKind, type ThreadId } from "@agent-group/contracts";

import {
  mergeProjectInstructionsIntoThreadNotes,
  useProjectInstructionsStore,
} from "../projectInstructionsStore";
import { promoteThreadCreate } from "./threadCreatePromotion";
import { newCommandId } from "./utils";

export async function promoteLocalDraftForChatTurn(input: {
  api: NativeApi;
  isLocalDraftThread: boolean;
  targetProjectKind: ProjectKind;
  title: string;
  threadNotes: string;
  threadCreate: Parameters<typeof promoteThreadCreate>[0];
  dispatchThreadNotes: (threadId: ThreadId, notes: string) => Promise<unknown>;
}): Promise<boolean> {
  if (!input.isLocalDraftThread) {
    return false;
  }

  const inheritedProjectInstructions =
    useProjectInstructionsStore.getState().instructionsByProjectId[input.threadCreate.projectId] ??
    "";
  const inheritedThreadNotes = mergeProjectInstructionsIntoThreadNotes({
    threadNotes: input.threadNotes,
    projectInstructions: inheritedProjectInstructions,
  });

  await promoteThreadCreate(input.threadCreate, input.api);
  // Notes are not part of thread.create. Seeding inherited instructions is best-effort.
  if (inheritedThreadNotes !== input.threadNotes && inheritedThreadNotes.trim().length > 0) {
    try {
      await input.dispatchThreadNotes(input.threadCreate.threadId, inheritedThreadNotes);
    } catch {
      // Project instructions remain available in the Environment panel.
    }
  }

  if (input.targetProjectKind === "chat") {
    await input.api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId: input.threadCreate.projectId,
      title: input.title,
    });
  }

  return true;
}
