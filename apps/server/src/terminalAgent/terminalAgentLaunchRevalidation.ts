import type { ServerSettings } from "@agent-group/contracts";

import type { ResolvedTerminalTarget } from "./terminalAgentRuntimeTypes";

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertTerminalLaunchContextUnchanged(input: {
  readonly expectedTarget: ResolvedTerminalTarget;
  readonly expectedSettings: ServerSettings;
  readonly currentTarget: ResolvedTerminalTarget;
  readonly currentSettings: ServerSettings;
}): void {
  const expected = input.expectedTarget;
  const current = input.currentTarget;
  if (
    current.threadId !== expected.threadId ||
    current.provider !== expected.provider ||
    current.runtimeMode !== expected.runtimeMode ||
    current.workspaceRoot !== expected.workspaceRoot ||
    current.coordinates.groupId !== expected.coordinates.groupId ||
    current.coordinates.sessionId !== expected.coordinates.sessionId ||
    !sameJson(current.modelSelection, expected.modelSelection) ||
    !input.currentSettings.enableManagedAgentTerminal ||
    !sameJson(
      input.currentSettings.providers[expected.provider],
      input.expectedSettings.providers[expected.provider],
    )
  ) {
    throw new Error(
      "Thread execution settings changed while Agent Terminal was starting. Retry the switch.",
    );
  }
}
