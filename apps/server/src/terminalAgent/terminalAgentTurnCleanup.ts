import { Effect } from "effect";

import { retireTerminalContextFile } from "./terminalAgentRuntimeCleanup";
import type { ActiveTerminalTurn, TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export async function retireTerminalTurnContext(
  runtime: TerminalAgentRuntimeRecord,
  turn: Pick<ActiveTerminalTurn, "turnId" | "context">,
): Promise<void> {
  await retireTerminalContextFile(runtime.runtimeDir, turn.context.filePath).catch((cause) => {
    Effect.runFork(
      Effect.logWarning("managed terminal context cleanup failed", {
        threadId: runtime.threadId,
        turnId: turn.turnId,
        cause,
      }),
    );
  });
  if (runtime.context === turn.context) runtime.context = null;
}

export async function retireTerminalTurnContexts(
  runtime: TerminalAgentRuntimeRecord,
  turn: ActiveTerminalTurn,
): Promise<void> {
  const pending = turn.pendingPrompt;
  turn.pendingPrompt = null;
  if (pending && pending.context !== turn.context) {
    await retireTerminalTurnContext(runtime, {
      turnId: turn.turnId,
      context: pending.context,
    });
  }
  await retireTerminalTurnContext(runtime, turn);
}
