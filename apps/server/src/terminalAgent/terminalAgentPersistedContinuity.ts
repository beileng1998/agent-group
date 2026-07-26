import type { TerminalAgentProvider, ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ProviderServiceShape } from "../provider/Services/ProviderService";

export async function readPersistedProviderResumeCursor(
  providerService: ProviderServiceShape,
  threadId: ThreadId,
  provider: TerminalAgentProvider,
): Promise<unknown> {
  if (!providerService.getSessionContinuity) return null;
  const continuity = await Effect.runPromise(
    providerService.getSessionContinuity({ threadId }),
  );
  return continuity?.provider === provider
    ? continuity.resumeCursor
    : null;
}
