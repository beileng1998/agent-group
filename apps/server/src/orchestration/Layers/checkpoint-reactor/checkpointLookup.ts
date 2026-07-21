import type {
  OrchestrationProjectShell,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../../../checkpointing/Utils.ts";
import { isGitRepository } from "../../../git/isRepo.ts";
import type { ProjectionSnapshotQueryShape } from "../../Services/ProjectionSnapshotQuery.ts";
import type { ProviderServiceShape } from "../../../provider/Services/ProviderService.ts";

export interface CheckpointLookupDependencies {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerService: ProviderServiceShape;
}

export function makeCheckpointLookup(dependencies: CheckpointLookupDependencies) {
  const { projectionSnapshotQuery, providerService } = dependencies;

  const resolveSessionRuntimeForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }>> {
    const thread = yield* projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.catch(() => Effect.succeed(Option.none())));
    if (Option.isNone(thread)) {
      return Option.none();
    }

    const sessions = yield* providerService.listSessions();
    const session = sessions.find((candidate) => candidate.threadId === thread.value.id);
    if (!session?.cwd) {
      return Option.none();
    }
    return Option.some({ threadId: session.threadId, cwd: session.cwd });
  });

  const getThreadDetail = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<OrchestrationThread | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const getProjectShell = Effect.fnUntraced(function* (
    projectId: ProjectId,
  ): Effect.fn.Return<OrchestrationProjectShell | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getProjectShellById(projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const resolveCheckpointCwd = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly thread: Pick<OrchestrationThread, "projectId" | "envMode" | "worktreePath">;
    readonly project: OrchestrationProjectShell;
    readonly preferSessionRuntime: boolean;
  }): Effect.fn.Return<string | undefined> {
    const fromSession = yield* resolveSessionRuntimeForThread(input.threadId);
    const fromThread = resolveThreadWorkspaceCwd({
      thread: input.thread,
      projects: [input.project],
    });

    const cwd = input.preferSessionRuntime
      ? (Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }) ?? fromThread)
      : (fromThread ??
        Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }));

    if (!cwd || !isGitRepository(cwd)) {
      return undefined;
    }
    return cwd;
  });

  return {
    getProjectShell,
    getThreadDetail,
    isGitWorkspace: isGitRepository,
    resolveCheckpointCwd,
    resolveSessionRuntimeForThread,
  };
}

export type CheckpointLookup = ReturnType<typeof makeCheckpointLookup>;
