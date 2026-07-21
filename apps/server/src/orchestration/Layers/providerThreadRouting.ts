import type { OrchestrationThread, ThreadId } from "@agent-group/contracts";
import { isRuntimeSubagent } from "../../agentGroup/session.ts";
import { Effect, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";

/** Resolves provider-created child rows back to their shared runtime session. */
export function makeProviderThreadRouting<ResolveError>(dependencies: {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
}) {
  const inferParentThreadFromSyntheticSubagentId = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ) {
    if (!(threadId as string).startsWith("subagent:")) return null;
    return Option.getOrNull(
      yield* dependencies.projectionSnapshotQuery.findSyntheticSubagentParentThread(threadId),
    );
  });

  const resolveProviderSessionThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* dependencies.resolveThread(threadId);
    if (!thread) return null;
    if (!isRuntimeSubagent(thread)) return thread;
    if (!thread.parentThreadId) {
      return (yield* inferParentThreadFromSyntheticSubagentId(thread.id)) ?? thread;
    }
    return (yield* dependencies.resolveThread(thread.parentThreadId)) ?? thread;
  });

  const resolveSubagentProviderThreadId = (
    threadId: ThreadId,
    parentThreadId: ThreadId | null | undefined,
  ): string | undefined => {
    if (!parentThreadId) return undefined;
    const prefix = `subagent:${parentThreadId}:`;
    const rawThreadId = threadId as string;
    return rawThreadId.startsWith(prefix) ? rawThreadId.slice(prefix.length) : undefined;
  };

  return { resolveProviderSessionThread, resolveSubagentProviderThreadId } as const;
}
