// FILE: terminalId.ts
// Purpose: Generate stable terminal pane identifiers without loading terminal runtimes.
// Layer: Web terminal value helper

import { randomUUID } from "~/lib/utils";

export function randomTerminalId(): string {
  return `terminal-${randomUUID()}`;
}
