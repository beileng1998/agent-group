import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import type { AgentGroupCoordinates } from "./state";
import { isAgentGroupSession } from "./session";

export function resolveAgentGroupSessionCoordinates(
  query: ProjectionSnapshotQueryShape,
  sessionId: ThreadId,
) {
  return Effect.gen(function* () {
    const threadOption = yield* query.getThreadShellById(sessionId);
    if (Option.isNone(threadOption)) return yield* Effect.fail(new Error("Session not found"));
    const thread = threadOption.value;
    if (!isAgentGroupSession(thread)) {
      return yield* Effect.fail(new Error("Thread is not an Agent Group session"));
    }

    const projectOption = yield* query.getProjectShellById(thread.projectId);
    if (Option.isNone(projectOption)) return yield* Effect.fail(new Error("Group not found"));
    const project = projectOption.value;
    if (project.kind !== "project") {
      return yield* Effect.fail(new Error("Project is not an Agent Group"));
    }

    return {
      workspaceRoot: project.workspaceRoot,
      groupId: project.id,
      sessionId: thread.id,
      ...(thread.parentThreadId !== undefined ? { parentSessionId: thread.parentThreadId } : {}),
      createdAt: thread.createdAt,
    } satisfies AgentGroupCoordinates;
  });
}

export function resolveAgentGroupConfigCoordinates(
  query: ProjectionSnapshotQueryShape,
  groupId: ProjectId,
) {
  return Effect.gen(function* () {
    const projectOption = yield* query.getProjectShellById(groupId);
    if (Option.isNone(projectOption)) return yield* Effect.fail(new Error("Group not found"));
    const project = projectOption.value;
    if (project.kind !== "project") {
      return yield* Effect.fail(new Error("Project is not an Agent Group"));
    }
    return { workspaceRoot: project.workspaceRoot, groupId: project.id };
  });
}
