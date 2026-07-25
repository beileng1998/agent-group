import type { ProviderRuntimeEvent } from "@agent-group/contracts";

export function terminalRuntimeCommandFence(event: ProviderRuntimeEvent) {
  return event.terminalRuntimeFence
    ? { terminalRuntimeFence: event.terminalRuntimeFence }
    : {};
}
