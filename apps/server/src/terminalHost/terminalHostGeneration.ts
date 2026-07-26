import type { TerminalHostGeneration, TerminalHostSession } from "./TerminalHostTypes";
import { TerminalHostStaleGenerationError } from "./TerminalHostTypes";

export function assertTerminalHostGeneration(
  session: TerminalHostSession,
  generation: TerminalHostGeneration,
): void {
  if (generation !== session.generation) {
    throw new TerminalHostStaleGenerationError(session.sessionId);
  }
}
