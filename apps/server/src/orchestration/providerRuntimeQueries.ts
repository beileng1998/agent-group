import {
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { isGitRepository } from "../git/isRepo.ts";
import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import {
  eventNeedsHeavyThreadDetail,
  threadDetailFromShell,
} from "./providerRuntimeIngestionValues.ts";

export function makeProviderRuntimeQueries(input: {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerService: ProviderServiceShape;
}) {
  const getThreadDetail = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<OrchestrationThread | undefined> {
    return Option.getOrUndefined(
      yield* input.projectionSnapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const getThreadShellDetail = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<OrchestrationThread | undefined> {
    const shell = Option.getOrUndefined(
      yield* input.projectionSnapshotQuery
        .getThreadShellById(threadId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
    return shell ? threadDetailFromShell(shell) : undefined;
  });

  const getThreadForEvent = (event: ProviderRuntimeEvent) =>
    eventNeedsHeavyThreadDetail(event)
      ? getThreadDetail(event.threadId)
      : getThreadShellDetail(event.threadId);

  const getProjectShell = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThread, "projectId">,
  ): Effect.fn.Return<OrchestrationProjectShell | undefined> {
    return Option.getOrUndefined(
      yield* input.projectionSnapshotQuery
        .getProjectShellById(thread.projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const isGitRepoForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* getThreadDetail(threadId);
    if (!thread) return false;
    const project = yield* getProjectShell(thread);
    if (!project) return false;
    const workspaceCwd = resolveThreadWorkspaceCwd({ thread, projects: [project] });
    return workspaceCwd ? isGitRepository(workspaceCwd) : false;
  });

  const supportsLiveTurnDiffPatch = Effect.fnUntraced(function* (
    provider: ProviderRuntimeEvent["provider"],
  ) {
    const capabilities = yield* input.providerService
      .getCapabilities(provider)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    return capabilities?.supportsLiveTurnDiffPatch === true;
  });

  return {
    getThreadDetail,
    getThreadShellDetail,
    getThreadForEvent,
    getProjectShell,
    isGitRepoForThread,
    supportsLiveTurnDiffPatch,
  };
}
