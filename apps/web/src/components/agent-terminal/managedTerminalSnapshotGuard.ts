import { TERMINAL_AGENT_SNAPSHOT_MAX_BYTES } from "@agent-group/contracts";

import { managedTerminalUtf8Bytes } from "./managedTerminalOutputPump";

export type ManagedTerminalSnapshotDecision = "accept" | "oversized" | "blocked";

interface SnapshotEpoch {
  readonly revision: number;
  readonly generation: string;
}

function epochKey(epoch: SnapshotEpoch): string {
  return `${epoch.revision}:${epoch.generation}`;
}

/** Prevents an irreducibly oversized snapshot from creating a reconnect loop. */
export class ManagedTerminalSnapshotGuard {
  private blockedEpoch: string | null = null;

  constructor(private readonly maxBytes = TERMINAL_AGENT_SNAPSHOT_MAX_BYTES) {}

  evaluate(epoch: SnapshotEpoch, snapshotAnsi: string): ManagedTerminalSnapshotDecision {
    const key = epochKey(epoch);
    if (this.blockedEpoch === key) return "blocked";
    if (managedTerminalUtf8Bytes(snapshotAnsi) > this.maxBytes) {
      this.blockedEpoch = key;
      return "oversized";
    }
    this.blockedEpoch = null;
    return "accept";
  }

  observeFence(epoch: SnapshotEpoch | null): void {
    if (epoch === null || epochKey(epoch) !== this.blockedEpoch) {
      this.blockedEpoch = null;
    }
  }

  retry(): void {
    this.blockedEpoch = null;
  }
}
