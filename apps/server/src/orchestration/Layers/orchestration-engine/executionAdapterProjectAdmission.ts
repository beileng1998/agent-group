import type { OrchestrationReadModel, ProjectId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ExecutionAdapterAuthorityShape } from "../../Services/ExecutionAdapterAuthority";

/** Hold every live Thread in a Project while its canonical runtime root changes. */
export function withProjectStructuredAdmission<A, E, R>(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly readModel: OrchestrationReadModel;
  readonly projectId: ProjectId;
  readonly claimId: string;
  readonly operation: Effect.Effect<A, E, R>;
}) {
  const threadIds = input.readModel.threads
    .filter((thread) => thread.projectId === input.projectId && thread.deletedAt === null)
    .map((thread) => thread.id);
  const acquired: Array<{
    readonly release: Effect.Effect<void>;
  }> = [];
  const releaseAcquired = () =>
    Effect.forEach(acquired, (claim) => claim.release, {
      concurrency: 1,
      discard: true,
    });
  const acquireAll = Effect.forEach(
    threadIds,
    (threadId) =>
      input.authority.acquireStructured(threadId, input.claimId).pipe(
        Effect.tap((claim) =>
          Effect.sync(() => {
            acquired.push(claim);
          }),
        ),
      ),
    { concurrency: 1 },
  ).pipe(Effect.onError(releaseAcquired));
  return Effect.acquireUseRelease(
    acquireAll,
    () => input.operation,
    releaseAcquired,
  );
}
