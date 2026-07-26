// FILE: terminalProcessGroup.ts
// Purpose: Capture and safely terminate a durable POSIX PTY process-group owner.
// Layer: Managed terminal process safety

import { spawnSync } from "node:child_process";

import {
  terminalOwnerIdentityFromCaptured,
  terminalOwnerIdentityMatches,
  type TerminalOwnerIdentity,
} from "./terminalProcessIdentity";

const PROCESS_GROUP_SCAN_TIMEOUT_MS = 1_000;
const PROCESS_GROUP_SCAN_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface TerminalProcessGroupIdentity {
  readonly pgid: number;
  readonly leaderIdentity: TerminalOwnerIdentity;
}

export type TerminalProcessGroupInspection =
  | { readonly status: "owned" | "absent" | "replaced"; readonly detail: null }
  | { readonly status: "unverified"; readonly detail: string };

interface ProcessGroupRow {
  readonly pid: number;
  readonly pgid: number;
  readonly zombie: boolean;
  readonly identity: TerminalOwnerIdentity | null;
}

export interface TerminalProcessGroupController {
  capture(rootPid: number): TerminalProcessGroupIdentity | null;
  inspect(identity: TerminalProcessGroupIdentity): TerminalProcessGroupInspection;
  signal(identity: TerminalProcessGroupIdentity, signal: "SIGKILL"): Error | null;
}

export interface TerminalProcessGroupControllerDependencies {
  readonly platform: NodeJS.Platform;
  readonly readProcessTable: () => string | null;
  readonly signalGroup: (pgid: number, signal: "SIGKILL") => Error | null;
}

function parseProcessGroupRow(line: string): ProcessGroupRow | null {
  const fields = line.trim().split(/\s+/g);
  const pid = Number(fields[0]);
  const pgid = Number(fields[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(pgid) || pgid <= 0) {
    return null;
  }
  const zombie = (fields[2] ?? "").startsWith("Z");
  const hasIdentity =
    fields.length >= 9 &&
    /^\d{1,2}:\d{2}:\d{2}$/.test(fields[6] ?? "") &&
    /^\d{4}$/.test(fields[7] ?? "");
  if (!hasIdentity) return { pid, pgid, zombie, identity: null };
  const command = fields.slice(8).join(" ").trim();
  if (command.length === 0) return { pid, pgid, zombie, identity: null };
  return {
    pid,
    pgid,
    zombie,
    identity: terminalOwnerIdentityFromCaptured({
      pid,
      startTime: fields.slice(3, 8).join(" "),
      command,
    }),
  };
}

export function parseProcessGroupTable(psOutput: string): readonly ProcessGroupRow[] {
  return psOutput
    .split(/\r?\n/g)
    .map(parseProcessGroupRow)
    .filter((row): row is ProcessGroupRow => row !== null);
}

function validateIdentity(identity: TerminalProcessGroupIdentity): string | null {
  if (
    !Number.isSafeInteger(identity.pgid) ||
    identity.pgid <= 0 ||
    identity.leaderIdentity.pid !== identity.pgid
  ) {
    return "The persisted terminal process-group identity is invalid.";
  }
  return null;
}

function classifyLeaderMismatch(
  expected: TerminalOwnerIdentity,
  actual: TerminalOwnerIdentity,
): TerminalProcessGroupInspection {
  return expected.startTime !== actual.startTime
    ? { status: "replaced", detail: null }
    : {
        status: "unverified",
        detail:
          `Terminal leader ${expected.pid} changed command without a new ` +
          "stable start identity.",
      };
}

export function makeTerminalProcessGroupController(
  dependencies: TerminalProcessGroupControllerDependencies,
): TerminalProcessGroupController {
  const inspect = (expected: TerminalProcessGroupIdentity): TerminalProcessGroupInspection => {
    const invalid = validateIdentity(expected);
    if (invalid !== null) return { status: "unverified", detail: invalid };
    if (dependencies.platform === "win32") {
      return {
        status: "unverified",
        detail: "POSIX process groups are unavailable on Windows.",
      };
    }
    const processTable = dependencies.readProcessTable();
    if (processTable === null) {
      return {
        status: "unverified",
        detail: `Process group ${expected.pgid} could not be inspected.`,
      };
    }
    const rows = parseProcessGroupTable(processTable).filter((row) => !row.zombie);
    const members = rows.filter((row) => row.pgid === expected.pgid);
    const currentLeader = rows.find((row) => row.pid === expected.leaderIdentity.pid);
    if (members.length === 0) {
      if (currentLeader === undefined) return { status: "absent", detail: null };
      if (currentLeader.identity === null) {
        return {
          status: "unverified",
          detail: `Process ${currentLeader.pid} was reused but its identity is unreadable.`,
        };
      }
      if (!terminalOwnerIdentityMatches(expected.leaderIdentity, currentLeader.identity)) {
        return classifyLeaderMismatch(expected.leaderIdentity, currentLeader.identity);
      }
      return {
        status: "unverified",
        detail: `Terminal leader ${currentLeader.pid} left its owned process group.`,
      };
    }
    if (currentLeader === undefined) {
      // POSIX keeps a process-group id reserved while any member survives.
      // With the captured leader gone, this is still the original owned group.
      return { status: "owned", detail: null };
    }
    if (currentLeader.pgid !== expected.pgid) {
      return {
        status: "unverified",
        detail: `Terminal process group ${expected.pgid} has conflicting leader state.`,
      };
    }
    if (currentLeader.identity === null) {
      return {
        status: "unverified",
        detail: `Terminal group leader ${currentLeader.pid} has no stable identity.`,
      };
    }
    return terminalOwnerIdentityMatches(expected.leaderIdentity, currentLeader.identity)
      ? { status: "owned", detail: null }
      : classifyLeaderMismatch(expected.leaderIdentity, currentLeader.identity);
  };

  return {
    capture: (rootPid) => {
      if (dependencies.platform === "win32") return null;
      if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
        throw new Error(`Terminal process PID ${rootPid} is invalid.`);
      }
      const processTable = dependencies.readProcessTable();
      if (processTable === null) {
        throw new Error(`Terminal process group for PID ${rootPid} could not be read.`);
      }
      const root = parseProcessGroupTable(processTable).find((row) => row.pid === rootPid);
      if (root === undefined || root.identity === null) {
        throw new Error(`Terminal process ${rootPid} has no stable group identity.`);
      }
      if (root.pgid !== rootPid) {
        throw new Error(`Terminal process ${rootPid} does not own process group ${root.pgid}.`);
      }
      return { pgid: root.pgid, leaderIdentity: root.identity };
    },
    inspect,
    signal: (identity, signal) => {
      const inspection = inspect(identity);
      if (inspection.status === "absent" || inspection.status === "replaced") {
        return null;
      }
      if (inspection.status === "unverified") {
        return new Error(inspection.detail);
      }
      return dependencies.signalGroup(identity.pgid, signal);
    },
  };
}

function readProcessTable(): string | null {
  try {
    const result = spawnSync("ps", ["-axo", "pid=,pgid=,stat=,lstart=,command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: PROCESS_GROUP_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_GROUP_SCAN_TIMEOUT_MS,
    });
    return result.error || result.status !== 0 ? null : result.stdout;
  } catch {
    return null;
  }
}

function signalGroup(pgid: number, signal: "SIGKILL"): Error | null {
  try {
    process.kill(-pgid, signal);
    return null;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ESRCH") return null;
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

export const defaultTerminalProcessGroupController = makeTerminalProcessGroupController({
  platform: process.platform,
  readProcessTable,
  signalGroup,
});

export const disabledTerminalProcessGroupController: TerminalProcessGroupController = {
  capture: () => null,
  inspect: () => ({ status: "absent", detail: null }),
  signal: () => null,
};
