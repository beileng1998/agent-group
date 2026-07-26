// FILE: terminalAgentProviderCursorAdoption.ts
// Purpose: Persist provider-native Terminal continuity through ProviderService.
// Layer: Managed terminal service support

import { Effect } from "effect";

import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import type { TerminalAgentProviderResumeCursor } from "./terminalAgentProtocol";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import { validatePiTerminalSessionFile } from "./piTerminalSessionFile";

export function makeTerminalProviderCursorAdopter(
  providerService: ProviderServiceShape,
  coordinator: ExecutionAdapterCoordinatorShape,
  stateDir: string,
) {
  return (
    runtime: TerminalAgentRuntimeRecord,
    cursor: TerminalAgentProviderResumeCursor,
    providerSessionId: string,
  ) =>
    Effect.runPromise(
      Effect.acquireUseRelease(
        coordinator.acquireTerminalOperation({
          threadId: runtime.threadId,
          revision: runtime.revision,
          generation: runtime.generation,
          claimId: `cursor:${runtime.runtimeInstanceId}`,
        }),
        () =>
          Effect.gen(function* () {
            const resumeCursor =
              runtime.provider === "pi"
                ? yield* Effect.tryPromise({
                    try: async () => {
                      if (typeof cursor !== "string") {
                        throw new Error("Pi session cursor must be a file path.");
                      }
                      const validated = await validatePiTerminalSessionFile({
                        stateDir,
                        workspaceRoot: runtime.workspaceRoot,
                        sessionPath: cursor,
                        expectedSessionId: providerSessionId,
                      });
                      if (
                        runtime.providerSessionId !== null &&
                        runtime.providerSessionId !== validated.sessionId
                      ) {
                        throw new Error("Pi session id does not match the launched runtime.");
                      }
                      return validated;
                    },
                    catch: (cause) =>
                      cause instanceof Error
                        ? cause
                        : new Error("Pi session cursor validation failed."),
                  })
                : cursor;
            yield* providerService.adoptSessionResumeCursor({
              threadId: runtime.threadId,
              provider: runtime.provider,
              runtimeMode: runtime.runtimeMode,
              resumeCursor,
            });
          }),
        (claim) => claim.release,
      ),
    );
}
