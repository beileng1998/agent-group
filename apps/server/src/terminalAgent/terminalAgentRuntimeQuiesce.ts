import { Effect } from "effect";

import { TerminalAgentServiceError } from "./Services/TerminalAgentService";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export function pauseTerminalRuntime(runtime: TerminalAgentRuntimeRecord) {
  return Effect.tryPromise({
    try: () => runtime.pauseHook(),
    catch: (cause) =>
      new TerminalAgentServiceError({
        reason: "bridge-failed",
        message: "Agent Terminal hook handling did not quiesce safely.",
        cause,
      }),
  }).pipe(Effect.tapError(() => Effect.sync(() => runtime.resumeHook())));
}
