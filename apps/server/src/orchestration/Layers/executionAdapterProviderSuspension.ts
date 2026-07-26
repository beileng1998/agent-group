import { ModelSelection, type ProviderSession } from "@agent-group/contracts";
import { Effect, Schema } from "effect";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService";

export interface StructuredRuntimeSuspension {
  readonly session: ProviderSession;
  readonly resume: Effect.Effect<void, unknown>;
  readonly finalize: Effect.Effect<void, unknown>;
}

function modelSelectionFor(session: ProviderSession) {
  if (session.model === undefined) return undefined;
  const candidate: unknown = { provider: session.provider, model: session.model };
  return Schema.is(ModelSelection)(candidate) ? candidate : undefined;
}

export const suspendProviderRuntime = (
  providerService: ProviderServiceShape,
  session: ProviderSession,
): Effect.Effect<StructuredRuntimeSuspension, unknown> =>
  Effect.gen(function* () {
    yield* providerService.stopRuntimeSession
      ? providerService.stopRuntimeSession({ threadId: session.threadId })
      : providerService.stopSession({ threadId: session.threadId });
    const stoppedSession =
      (yield* providerService.listSessions()).find(
        (candidate) => candidate.threadId === session.threadId,
      ) ?? session;
    const stoppedModelSelection = modelSelectionFor(stoppedSession);
    return {
      session: stoppedSession,
      resume: providerService
        .startSession(stoppedSession.threadId, {
          threadId: stoppedSession.threadId,
          provider: stoppedSession.provider,
          ...(stoppedSession.cwd !== undefined ? { cwd: stoppedSession.cwd } : {}),
          ...(stoppedModelSelection !== undefined ? { modelSelection: stoppedModelSelection } : {}),
          ...(stoppedSession.resumeCursor !== undefined
            ? { resumeCursor: stoppedSession.resumeCursor }
            : {}),
          runtimeMode: stoppedSession.runtimeMode,
        })
        .pipe(Effect.asVoid),
      // Keep the old cursor as a compensation point until the terminal's
      // SessionStart hook atomically adopts its new provider-native cursor.
      finalize: Effect.void,
    };
  });
