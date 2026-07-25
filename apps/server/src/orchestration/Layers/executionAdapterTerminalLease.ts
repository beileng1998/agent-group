import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { TerminalHostGeneration } from "../../terminalHost/TerminalHost";
import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority";

/** Fence one physical host operation against stop/switch/delete transitions. */
export function withTerminalOperationLease<A, E, R>(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadId: ThreadId;
  readonly revision: number;
  readonly generation: TerminalHostGeneration;
  readonly operation: string;
  readonly effect: Effect.Effect<A, E, R>;
}) {
  return Effect.acquireUseRelease(
    input.authority.acquireTerminal(
      input.threadId,
      input.revision,
      input.generation,
      `${input.operation}:${crypto.randomUUID()}`,
    ),
    () => input.effect,
    (claim) => claim.release,
  );
}
