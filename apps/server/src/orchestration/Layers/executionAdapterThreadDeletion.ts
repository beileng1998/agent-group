import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority";
import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";

/** Persist deletion ownership, drain epoch leases, then remove any owned PTY. */
export function teardownExecutionAdapterForDeletion(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly terminalHost: TerminalHostServiceShape;
  readonly threadId: ThreadId;
  readonly sessionId: string;
}) {
  return Effect.gen(function* () {
    const deleting = yield* input.authority.beginThreadDeletion(input.threadId);
    yield* input.authority.awaitClaimsDrained(input.threadId);
    if (deleting.adapter === "structured") return;
    yield* input.terminalHost.kill(input.sessionId);
    yield* input.authority.completeTerminalDeletion(input.threadId, deleting.revision);
  });
}
