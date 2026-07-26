// FILE: terminalHostTeardown.ts
// Purpose: Physically verified, retryable teardown for one managed PTY owner.
// Layer: Server terminal host lifecycle

import type { PtyProcess } from "../terminal/Services/PTY";
import type { CapturedProcessTree, ProcessTreeKiller } from "../terminal/processTreeKiller";
import type {
  TerminalProcessGroupController,
  TerminalProcessGroupIdentity,
} from "../terminal/terminalProcessGroup";
import { TerminalHostTeardownError } from "./TerminalHostTypes";

export interface TerminalTeardownOwner {
  readonly sessionId: string;
  readonly pty: PtyProcess;
  isAlive: boolean;
  teardownTree: CapturedProcessTree | null;
  lastTreeCaptureAt: number;
  processGroupIdentity: TerminalProcessGroupIdentity | null;
}

const TREE_REFRESH_INTERVAL_MS = 1_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function refreshTerminalSessionTree(input: {
  readonly owner: TerminalTeardownOwner;
  readonly processTreeKiller: ProcessTreeKiller;
  readonly force?: boolean;
  readonly invalidateOnIncomplete?: boolean;
}): void {
  const now = Date.now();
  if (!input.force && now - input.owner.lastTreeCaptureAt < TREE_REFRESH_INTERVAL_MS) {
    return;
  }
  input.owner.lastTreeCaptureAt = now;
  let captured: CapturedProcessTree;
  try {
    captured = input.processTreeKiller.capture(input.owner.pty.pid);
  } catch {
    if (input.invalidateOnIncomplete) {
      input.owner.teardownTree = {
        ...(input.owner.teardownTree ?? {}),
        descendants: input.owner.teardownTree?.descendants ?? [],
        captureComplete: false,
      };
    }
    return;
  }
  if (captured.captureComplete === true || input.owner.teardownTree?.captureComplete !== true) {
    input.owner.teardownTree = captured;
  } else if (input.invalidateOnIncomplete) {
    input.owner.teardownTree = {
      ...input.owner.teardownTree,
      captureComplete: false,
    };
  }
}

export async function teardownTerminalSession(input: {
  readonly owner: TerminalTeardownOwner;
  readonly processTreeKiller: ProcessTreeKiller;
  readonly killGraceMs: number;
  readonly platform: NodeJS.Platform;
  readonly processGroupController: TerminalProcessGroupController;
  readonly waitForExit: (timeoutMs: number) => Promise<boolean>;
}): Promise<void> {
  const { owner } = input;
  const signalErrors: string[] = [];
  try {
    refreshTerminalSessionTree({
      owner,
      processTreeKiller: input.processTreeKiller,
      force: true,
      invalidateOnIncomplete: owner.isAlive,
    });
    if (owner.teardownTree === null) {
      throw new Error("process tree capture did not return a snapshot");
    }
    const tree = owner.teardownTree;
    if (owner.isAlive && input.platform !== "win32") {
      try {
        owner.pty.kill("SIGTERM");
      } catch (cause) {
        signalErrors.push(
          `pty:${owner.pty.pid}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      await input.waitForExit(input.killGraceMs);
    }

    // Windows must traverse the tree before the owner disappears. POSIX can
    // safely signal the pre-TERM stable identities after reparenting.
    input.processTreeKiller.signal({
      rootPid: owner.pty.pid,
      signal: input.platform === "win32" ? "SIGTERM" : "SIGKILL",
      tree,
      // taskkill /T has no stable process identity. Once node-pty reports a
      // natural Windows exit, reusing that PID could target an unrelated tree.
      includeRootTree: input.platform !== "win32" || owner.isAlive,
      // A fresh PID walk after TERM can retarget a reused PID. Managed
      // terminals use only captured stable identities plus the durable PGID.
      allowLegacyTreeFallback: false,
      onError: (cause, context) => {
        signalErrors.push(`${context.source}:${context.pid}: ${cause.message}`);
      },
    });
    if (owner.isAlive) {
      try {
        owner.pty.kill("SIGKILL");
      } catch (cause) {
        signalErrors.push(
          `pty:${owner.pty.pid}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      await input.waitForExit(input.killGraceMs);
    }

    let groupExitVerified = true;
    if (input.platform !== "win32" && owner.processGroupIdentity !== null) {
      const identity = owner.processGroupIdentity;
      const groupError = input.processGroupController.signal(identity, "SIGKILL");
      if (groupError) signalErrors.push(`process-group:${identity.pgid}: ${groupError.message}`);
      const deadline = Date.now() + input.killGraceMs;
      let groupInspection = input.processGroupController.inspect(identity);
      while (groupInspection.status === "owned" && Date.now() < deadline) {
        await wait(Math.min(20, Math.max(1, deadline - Date.now())));
        groupInspection = input.processGroupController.inspect(identity);
      }
      if (groupInspection.status === "unverified") {
        signalErrors.push(`process-group:${identity.pgid}: ${groupInspection.detail}`);
      }
      groupExitVerified =
        groupInspection.status === "absent" || groupInspection.status === "replaced";
    }

    const inspection = input.processTreeKiller.inspect?.(tree);
    const ownershipCaptureVerified =
      tree.captureComplete === true ||
      (input.platform !== "win32" && owner.processGroupIdentity !== null);
    const treeExitVerified =
      ownershipCaptureVerified &&
      groupExitVerified &&
      (inspection === undefined
        ? !owner.isAlive
        : inspection.verified && inspection.survivors.length === 0);
    if (!treeExitVerified) {
      const detail = [
        owner.isAlive ? "PTY root is still alive" : null,
        "captured process tree exit is unverified",
        ...signalErrors,
      ]
        .filter((entry): entry is string => entry !== null)
        .join("; ");
      throw new TerminalHostTeardownError(owner.sessionId, detail);
    }
    owner.isAlive = false;
  } catch (cause) {
    if (cause instanceof TerminalHostTeardownError) {
      throw cause;
    }
    throw new TerminalHostTeardownError(
      owner.sessionId,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

export async function teardownTerminalSessions(input: {
  readonly sessionIds: readonly string[];
  readonly teardown: (sessionId: string) => Promise<void>;
}): Promise<void> {
  const results = await Promise.allSettled(
    input.sessionIds.map(async (sessionId) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await input.teardown(sessionId);
          return;
        } catch (cause) {
          lastError = cause;
          await wait(Math.min(100 * (attempt + 1), 300));
        }
      }
      throw lastError;
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Terminal host could not verify all process exits");
  }
}
