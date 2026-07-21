// FILE: processTreeKiller.ts
// Purpose: Captures and terminates PTY process trees without losing reparented children.
// Layer: Terminal infrastructure utility
// Depends on: node child_process, process signals, and a legacy PTY-only tree-kill fallback.
import { spawnSync } from "node:child_process";

import treeKill from "tree-kill";

const PROCESS_TREE_SCAN_TIMEOUT_MS = 1_000;
const PROCESS_TREE_SCAN_MAX_BUFFER_BYTES = 262_144;
const PROCESS_COMMAND_SCAN_MAX_BUFFER_BYTES = 262_144;
const POSIX_TREE_WALK_MAX_VISITED = 256;

export type ProcessChildrenMap = Map<number, Array<CapturedProcess>>;
export type ProcessCommandMap = Map<number, string>;
export type ProcessIdentityMap = Map<number, { command: string; startTime: string }>;

export interface CapturedProcess {
  pid: number;
  command: string;
  /** Stable process start identity from `ps lstart`, normalized to C locale. */
  startTime?: string;
}

export interface CapturedProcessTree {
  root?: CapturedProcess;
  descendants: CapturedProcess[];
  /** False when the process snapshot failed and descendant absence is unproven. */
  captureComplete?: boolean;
  /** Windows-only proof that synchronous taskkill accepted termination of the full tree. */
  platformTreeExitProven?: boolean;
}

export interface CapturedProcessTreeInspection {
  /** False when the process table could not be read, so exit cannot be proven. */
  verified: boolean;
  survivors: CapturedProcess[];
}

export type TerminalKillSignal = "SIGTERM" | "SIGKILL";

export interface ProcessTreeKiller {
  capture(rootPid: number): CapturedProcessTree;
  inspect?(tree: CapturedProcessTree): CapturedProcessTreeInspection;
  signal(input: {
    rootPid: number;
    signal: TerminalKillSignal;
    tree: CapturedProcessTree;
    includeRootTree?: boolean | undefined;
    /** Legacy PTY-only fallback; supervised provider teardown never enables a fresh tree walk. */
    allowLegacyTreeFallback?: boolean | undefined;
    onError: (
      error: Error,
      context: {
        pid: number;
        source: "root" | "captured" | "windows-tree" | "legacy-tree";
      },
    ) => void;
  }): void;
}

export interface ProcessTreeKillerDependencies {
  platform: NodeJS.Platform;
  captureChildrenMap: () => ProcessChildrenMap | null;
  readCurrentIdentities: (pids: readonly number[]) => ProcessIdentityMap | null;
  signalPid: (pid: number, signal: TerminalKillSignal) => Error | null;
  signalWindowsTree: (rootPid: number, signal: TerminalKillSignal) => Error | null;
  signalLegacyTree: (
    rootPid: number,
    signal: TerminalKillSignal,
    callback: (error?: Error | null) => void,
  ) => void;
}

export function parseProcessChildrenMap(psOutput: string): ProcessChildrenMap {
  const childrenByParentPid: ProcessChildrenMap = new Map();
  for (const line of psOutput.split(/\r?\n/g)) {
    const [pidRaw, ppidRaw, ...details] = line.trim().split(/\s+/g);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    const identity = parseStartIdentity(details);
    const command = (identity?.commandParts ?? details).join(" ").trim();
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (command.length === 0) continue;
    const siblings = childrenByParentPid.get(ppid) ?? [];
    siblings.push({ pid, command, ...(identity ? { startTime: identity.startTime } : {}) });
    childrenByParentPid.set(ppid, siblings);
  }
  return childrenByParentPid;
}

function parseStartIdentity(
  details: readonly string[],
): { startTime: string; commandParts: readonly string[] } | null {
  if (
    details.length < 6 ||
    !/^\d{1,2}:\d{2}:\d{2}$/.test(details[3] ?? "") ||
    !/^\d{4}$/.test(details[4] ?? "")
  ) {
    return null;
  }
  return {
    startTime: details.slice(0, 5).join(" "),
    commandParts: details.slice(5),
  };
}

export function parseProcessCommandMap(psOutput: string): ProcessCommandMap {
  const commandsByPid: ProcessCommandMap = new Map();
  for (const line of psOutput.split(/\r?\n/g)) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2]?.trim() ?? "";
    if (!Number.isInteger(pid) || command.length === 0) continue;
    commandsByPid.set(pid, command);
  }
  return commandsByPid;
}

export function parseProcessIdentityMap(psOutput: string): ProcessIdentityMap {
  const identities = new Map<number, { command: string; startTime: string }>();
  for (const line of psOutput.split(/\r?\n/g)) {
    const [pidRaw, ...details] = line.trim().split(/\s+/g);
    const pid = Number(pidRaw);
    const identity = parseStartIdentity(details);
    if (!Number.isInteger(pid) || !identity) continue;
    const command = identity.commandParts.join(" ").trim();
    if (command.length === 0) continue;
    identities.set(pid, { command, startTime: identity.startTime });
  }
  return identities;
}

export function processIdentitySnapshotFromPsResult(input: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: unknown;
}): ProcessIdentityMap | null {
  if (input.error) return null;
  if (input.status === 1 && input.stdout.trim() === "" && input.stderr.trim() === "") {
    return new Map();
  }
  if (input.status !== 0) return null;
  return parseProcessIdentityMap(input.stdout);
}

export function collectDescendantProcesses(
  parentPid: number,
  childrenByParentPid: ProcessChildrenMap,
): CapturedProcess[] {
  return captureDescendantProcessTree(parentPid, childrenByParentPid).descendants;
}

export function captureDescendantProcessTree(
  parentPid: number,
  childrenByParentPid: ProcessChildrenMap,
): CapturedProcessTree {
  const root = [...childrenByParentPid.values()]
    .flat()
    .find((process) => process.pid === parentPid);
  const descendants: CapturedProcess[] = [];
  const stack = [...(childrenByParentPid.get(parentPid) ?? [])].reverse();
  const visited = new Set<number>([parentPid]);

  while (stack.length > 0 && descendants.length < POSIX_TREE_WALK_MAX_VISITED) {
    const child = stack.pop();
    if (!child || visited.has(child.pid)) {
      continue;
    }
    visited.add(child.pid);
    descendants.push(child);

    const nestedChildren = childrenByParentPid.get(child.pid) ?? [];
    for (const nestedChild of [...nestedChildren].reverse()) {
      stack.push(nestedChild);
    }
  }

  return {
    ...(root ? { root } : {}),
    descendants,
    captureComplete:
      root?.startTime !== undefined &&
      stack.length === 0 &&
      descendants.every((descendant) => descendant.startTime !== undefined),
  };
}

function captureProcessChildrenMapSync(): ProcessChildrenMap | null {
  try {
    const result = spawnSync("ps", ["-eo", "pid=,ppid=,lstart=,command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: PROCESS_TREE_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_TREE_SCAN_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    return parseProcessChildrenMap(result.stdout);
  } catch {
    return null;
  }
}

function readCurrentIdentities(pids: readonly number[]): ProcessIdentityMap | null {
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (uniquePids.length === 0) return new Map();
  try {
    const result = spawnSync("ps", ["-p", uniquePids.join(","), "-o", "pid=,lstart=,command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: PROCESS_COMMAND_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_TREE_SCAN_TIMEOUT_MS,
    });
    return processIdentitySnapshotFromPsResult(result);
  } catch {
    return null;
  }
}

function signalPid(pid: number, signal: TerminalKillSignal): Error | null {
  try {
    globalThis.process.kill(pid, signal);
    return null;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno?.code === "ESRCH") {
      return null;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function signalWindowsTree(rootPid: number, _signal: TerminalKillSignal): Error | null {
  try {
    const result = spawnSync("taskkill", ["/pid", String(rootPid), "/T", "/F"], {
      encoding: "utf8",
      maxBuffer: PROCESS_COMMAND_SCAN_MAX_BUFFER_BYTES,
      timeout: PROCESS_TREE_SCAN_TIMEOUT_MS,
    });
    if (result.error) return result.error;
    if (result.status === 0) return null;
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    return new Error(`taskkill failed: ${detail}`);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function matchesCapturedProcessIdentity(
  process: CapturedProcess,
  currentIdentities: ProcessIdentityMap | null,
): boolean {
  if (!process.startTime) return false;
  return currentIdentities?.get(process.pid)?.startTime === process.startTime;
}

// Creates an injectable killer so tests can exercise PID-reuse safeguards safely.
export function createProcessTreeKiller(
  dependencies: Partial<ProcessTreeKillerDependencies> = {},
): ProcessTreeKiller {
  const deps: ProcessTreeKillerDependencies = {
    platform: globalThis.process.platform,
    captureChildrenMap: captureProcessChildrenMapSync,
    readCurrentIdentities,
    signalPid,
    signalWindowsTree,
    signalLegacyTree: treeKill,
    ...dependencies,
  };

  return {
    capture: (rootPid) => {
      if (!Number.isInteger(rootPid) || rootPid <= 0) {
        return { descendants: [], captureComplete: false };
      }
      if (deps.platform === "win32") {
        // taskkill /T owns traversal on Windows, where POSIX start identities are unavailable.
        return {
          descendants: [],
          captureComplete: true,
          platformTreeExitProven: false,
        };
      }
      const childrenByParentPid = deps.captureChildrenMap();
      if (!childrenByParentPid) return { descendants: [], captureComplete: false };
      return captureDescendantProcessTree(rootPid, childrenByParentPid);
    },
    inspect: (tree) => {
      if (deps.platform === "win32") {
        return { verified: tree.platformTreeExitProven === true, survivors: [] };
      }
      if (tree.descendants.length === 0) {
        return { verified: true, survivors: [] };
      }
      const currentIdentities = deps.readCurrentIdentities(
        tree.descendants.map((descendant) => descendant.pid),
      );
      if (currentIdentities === null) {
        return { verified: false, survivors: [...tree.descendants] };
      }
      return {
        verified: true,
        survivors: tree.descendants.filter((descendant) =>
          matchesCapturedProcessIdentity(descendant, currentIdentities),
        ),
      };
    },
    signal: ({
      rootPid,
      signal,
      tree,
      includeRootTree = true,
      allowLegacyTreeFallback = false,
      onError,
    }) => {
      if (deps.platform === "win32") {
        if (!includeRootTree) return;
        const error = deps.signalWindowsTree(rootPid, signal);
        if (error) {
          onError(error, { pid: rootPid, source: "windows-tree" });
        } else {
          tree.platformTreeExitProven = true;
        }
        return;
      }

      if (allowLegacyTreeFallback && includeRootTree) {
        deps.signalLegacyTree(rootPid, signal, (error) => {
          if (error) onError(error, { pid: rootPid, source: "legacy-tree" });
        });
      }

      // The supervised path disables the legacy walk: every direct target comes from the pre-TERM
      // capture and is revalidated by stable start identity immediately before signaling.
      const candidates = [
        ...tree.descendants,
        ...(includeRootTree && tree.root ? [tree.root] : []),
      ];
      const currentIdentities = deps.readCurrentIdentities(
        candidates.map((process) => process.pid),
      );
      const capturedProcesses = tree.descendants.filter((descendant) =>
        matchesCapturedProcessIdentity(descendant, currentIdentities),
      );
      for (const descendant of capturedProcesses.toReversed()) {
        const error = deps.signalPid(descendant.pid, signal);
        if (error) {
          onError(error, { pid: descendant.pid, source: "captured" });
        }
      }
      if (
        includeRootTree &&
        tree.root &&
        tree.root.pid === rootPid &&
        matchesCapturedProcessIdentity(tree.root, currentIdentities)
      ) {
        const error = deps.signalPid(rootPid, signal);
        if (error) onError(error, { pid: rootPid, source: "root" });
      }
    },
  };
}

export const defaultProcessTreeKiller: ProcessTreeKiller = createProcessTreeKiller();
