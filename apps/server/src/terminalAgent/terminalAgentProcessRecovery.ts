// FILE: terminalAgentProcessRecovery.ts
// Purpose: Conservatively prove a persisted PTY root is gone before respawn.
// Layer: Managed terminal crash recovery

import {
  inspectTerminalOwner,
  terminalOwnerIdentityMatches,
  type TerminalOwnerIdentity,
} from "../terminal/terminalProcessIdentity";
import {
  defaultTerminalProcessGroupController,
  type TerminalProcessGroupController,
  type TerminalProcessGroupIdentity,
} from "../terminal/terminalProcessGroup";

export type TerminalProcessPresence = "absent" | "alive" | "unverified";

export interface TerminalProcessInspection {
  readonly presence: TerminalProcessPresence;
  readonly detail: string | null;
  readonly identity?: TerminalOwnerIdentity;
}

export interface TerminalOwnerExitVerification {
  readonly verified: boolean;
  readonly detail: string | null;
}

export function inspectTerminalProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): TerminalProcessInspection {
  return inspectTerminalOwner(pid, { platform });
}

export async function waitForPersistedTerminalOwnerExit(input: {
  readonly pid: number | null;
  readonly ownerIdentity: TerminalOwnerIdentity | null;
  readonly processGroupIdentity?: TerminalProcessGroupIdentity | null;
  readonly inspect?: (pid: number) => TerminalProcessInspection;
  readonly processGroupController?: TerminalProcessGroupController;
  readonly maxWaitMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly platform?: NodeJS.Platform;
}): Promise<TerminalOwnerExitVerification> {
  const platform = input.platform ?? process.platform;
  const processGroupIdentity = input.processGroupIdentity ?? null;
  if (processGroupIdentity !== null) {
    if (
      input.pid === null ||
      input.ownerIdentity === null ||
      input.pid !== processGroupIdentity.pgid ||
      !terminalOwnerIdentityMatches(input.ownerIdentity, processGroupIdentity.leaderIdentity)
    ) {
      return {
        verified: false,
        detail: "The persisted terminal process-group identity is inconsistent.",
      };
    }
    if (platform === "win32") {
      return {
        verified: false,
        detail: "A persisted POSIX terminal process group cannot be safely terminated on Windows.",
      };
    }
    const controller = input.processGroupController ?? defaultTerminalProcessGroupController;
    const pollMs = Math.max(1, input.pollMs ?? 25);
    const maxWaitMs = Math.max(0, input.maxWaitMs ?? 1_000);
    const sleep =
      input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const attempts = Math.max(1, Math.ceil(maxWaitMs / pollMs) + 1);
    let signalled = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const inspection = controller.inspect(processGroupIdentity);
      if (inspection.status === "absent" || inspection.status === "replaced") {
        return { verified: true, detail: null };
      }
      if (inspection.status === "unverified") {
        return { verified: false, detail: inspection.detail };
      }
      if (!signalled) {
        signalled = true;
        const signalError = controller.signal(processGroupIdentity, "SIGKILL");
        if (signalError !== null) {
          return { verified: false, detail: signalError.message };
        }
      }
      if (attempt + 1 < attempts) await sleep(pollMs);
    }
    return {
      verified: false,
      detail:
        `Persisted Agent Terminal process group ${processGroupIdentity.pgid} ` +
        "is still present. Refusing to spawn a duplicate process.",
    };
  }
  if (input.pid === null) {
    return {
      verified: false,
      detail:
        "The previous terminal has no persisted PID or process-group identity. " +
        "Refusing to assume that every process exited.",
    };
  }
  if (input.ownerIdentity !== null && input.ownerIdentity.pid !== input.pid) {
    return {
      verified: false,
      detail: "The persisted terminal PID does not match its owner identity.",
    };
  }
  const inspect = input.inspect ?? ((pid: number) => inspectTerminalProcess(pid, platform));
  const pollMs = Math.max(1, input.pollMs ?? 25);
  // Startup may reconcile thousands of durable Threads serially. Production
  // probes therefore fail fast; callers can retry later without risking a
  // cumulative boot delay. Tests may inject a bounded grace window.
  const maxWaitMs = Math.max(0, input.maxWaitMs ?? 0);
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, Math.ceil(maxWaitMs / pollMs) + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const inspection = inspect(input.pid);
    if (inspection.presence === "absent") {
      return {
        verified: false,
        detail:
          `Persisted terminal PID ${input.pid} exited, but its legacy record ` +
          "has no process-group identity to prove descendant exit.",
      };
    }
    if (inspection.presence === "unverified") {
      return {
        verified: false,
        detail: inspection.detail ?? `Persisted terminal PID ${input.pid} could not be inspected.`,
      };
    }
    if (input.ownerIdentity === null) {
      return {
        verified: false,
        detail:
          `Persisted terminal PID ${input.pid} is still present but its legacy record ` +
          "has no reusable process identity.",
      };
    }
    if (inspection.identity === undefined) {
      return {
        verified: false,
        detail:
          `Persisted terminal PID ${input.pid} exists but its current identity ` +
          "could not be verified.",
      };
    }
    if (!terminalOwnerIdentityMatches(input.ownerIdentity, inspection.identity)) {
      return {
        verified: false,
        detail:
          input.ownerIdentity.startTime === inspection.identity.startTime
            ? `Persisted terminal PID ${input.pid} changed command without a new stable start identity.`
            : `Persisted terminal PID ${input.pid} was reused, but the legacy record has no process-group identity to prove descendant exit.`,
      };
    }
    if (attempt + 1 < attempts) {
      await sleep(pollMs);
    }
  }
  return {
    verified: false,
    detail:
      `Persisted Agent Terminal owner ${input.pid} is still present. ` +
      "Refusing to spawn a duplicate process.",
  };
}
