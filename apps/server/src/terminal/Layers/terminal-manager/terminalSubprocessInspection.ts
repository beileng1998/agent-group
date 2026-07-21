import path from "node:path";

import {
  deriveTerminalProcessIdentity,
  type TerminalCliKind,
} from "@agent-group/shared/terminalThreads";

import { runProcess } from "../../../processRunner";
import { parseProcessChildrenMap, type ProcessChildrenMap } from "../../processTreeKiller";
import type { TerminalSessionState } from "../../Services/Manager";

const PROVIDER_INPUT_ACTIVITY_GRACE_MS = 120_000;
const PROVIDER_OUTPUT_ACTIVITY_GRACE_MS = 30_000;
const POSIX_SUBPROCESS_TREE_WALK_MAX_VISITED = 256;
const SHELL_LIKE_PROCESS_NAMES = new Set([
  "bash",
  "dash",
  "fish",
  "ksh",
  "login",
  "nu",
  "screen",
  "sh",
  "tcsh",
  "tmux",
  "zellij",
  "zsh",
]);

export interface TerminalSubprocessActivity {
  cliKind: TerminalCliKind | null;
  hasRunningSubprocess: boolean;
  hasProviderDescendant: boolean;
  hasNonProviderSubprocess: boolean;
}

export type TerminalSubprocessChecker = (
  terminalPid: number,
) => Promise<boolean | TerminalSubprocessActivity>;

export function normalizeSubprocessActivity(
  result: boolean | TerminalSubprocessActivity,
): TerminalSubprocessActivity {
  return typeof result === "boolean"
    ? {
        cliKind: null,
        hasNonProviderSubprocess: result,
        hasProviderDescendant: false,
        hasRunningSubprocess: result,
      }
    : result;
}

export function isProviderSessionBusy(session: TerminalSessionState, now: number): boolean {
  const lastInputAt = session.lastInputAt ?? 0;
  const lastOutputAt = session.lastOutputAt ?? 0;
  const latestSignalAt = Math.max(lastInputAt, lastOutputAt);
  if (latestSignalAt <= 0) return false;
  if (lastOutputAt >= lastInputAt) {
    return now - lastOutputAt <= PROVIDER_OUTPUT_ACTIVITY_GRACE_MS;
  }
  return now - lastInputAt <= PROVIDER_INPUT_ACTIVITY_GRACE_MS;
}

function emptySubprocessActivity(): TerminalSubprocessActivity {
  return {
    cliKind: null,
    hasNonProviderSubprocess: false,
    hasProviderDescendant: false,
    hasRunningSubprocess: false,
  };
}

function isShellLikeProcessName(command: string): boolean {
  const normalized = path.basename(command.trim().split(/\s+/g)[0] ?? "").toLowerCase();
  return SHELL_LIKE_PROCESS_NAMES.has(normalized);
}

export function inspectSubprocessActivity(
  parentPid: number,
  childrenByParentPid: ProcessChildrenMap,
): TerminalSubprocessActivity {
  const children = childrenByParentPid.get(parentPid) ?? [];
  let cliKind: TerminalCliKind | null = null;
  let hasNonProviderSubprocess = false;
  let hasProviderDescendant = false;
  let hasRunningSubprocess = false;
  for (const child of children) {
    const nestedActivity = inspectSubprocessActivity(child.pid, childrenByParentPid);
    const childCliKind = deriveTerminalProcessIdentity(child.command)?.cliKind ?? null;
    if (childCliKind || nestedActivity.hasProviderDescendant) hasProviderDescendant = true;
    if (
      (!childCliKind && !isShellLikeProcessName(child.command)) ||
      nestedActivity.hasNonProviderSubprocess
    ) {
      hasNonProviderSubprocess = true;
    }
    cliKind = cliKind ?? childCliKind ?? nestedActivity.cliKind;
    if (!isShellLikeProcessName(child.command) || nestedActivity.hasRunningSubprocess) {
      hasRunningSubprocess = true;
    }
  }
  return { cliKind, hasNonProviderSubprocess, hasProviderDescendant, hasRunningSubprocess };
}

export async function captureProcessChildrenMap(): Promise<ProcessChildrenMap | null> {
  try {
    const result = await runProcess("ps", ["-eo", "pid=,ppid=,command="], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 262_144,
      outputMode: "truncate",
    });
    if (result.code !== 0 || result.stdoutTruncated) return null;
    return parseProcessChildrenMap(result.stdout);
  } catch {
    return null;
  }
}

async function checkWindowsSubprocessActivity(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  const command = [
    `$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${terminalPid}" -ErrorAction SilentlyContinue`,
    "if ($children) { exit 0 }",
    "exit 1",
  ].join("; ");
  try {
    const result = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        timeoutMs: 1_500,
        allowNonZeroExit: true,
        maxBufferBytes: 32_768,
        outputMode: "truncate",
      },
    );
    return {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: result.code === 0,
    };
  } catch {
    return emptySubprocessActivity();
  }
}

async function readPosixChildPids(parentPid: number): Promise<number[]> {
  try {
    const result = await runProcess("pgrep", ["-P", String(parentPid)], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 32_768,
      outputMode: "truncate",
    });
    if (result.code !== 0) return [];
    return result.stdout
      .split(/\s+/g)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function readPosixCommand(pid: number): Promise<string> {
  try {
    const result = await runProcess("ps", ["-p", String(pid), "-o", "command="], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 32_768,
      outputMode: "truncate",
    });
    return result.code === 0 ? result.stdout.trim() : "";
  } catch {
    return "";
  }
}

async function checkPosixSubprocessActivityByTreeWalk(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  let visited = 0;
  const inspectPid = async (parentPid: number): Promise<TerminalSubprocessActivity> => {
    if (visited >= POSIX_SUBPROCESS_TREE_WALK_MAX_VISITED) {
      return {
        cliKind: null,
        hasNonProviderSubprocess: true,
        hasProviderDescendant: false,
        hasRunningSubprocess: true,
      };
    }
    const childPids = await readPosixChildPids(parentPid);
    let cliKind: TerminalCliKind | null = null;
    let hasNonProviderSubprocess = false;
    let hasProviderDescendant = false;
    let hasRunningSubprocess = false;
    for (const childPid of childPids) {
      visited += 1;
      const command = await readPosixCommand(childPid);
      if (!command) continue;
      const nestedActivity = await inspectPid(childPid);
      const childCliKind = deriveTerminalProcessIdentity(command)?.cliKind ?? null;
      if (childCliKind || nestedActivity.hasProviderDescendant) hasProviderDescendant = true;
      if (
        (!childCliKind && !isShellLikeProcessName(command)) ||
        nestedActivity.hasNonProviderSubprocess
      ) {
        hasNonProviderSubprocess = true;
      }
      cliKind = cliKind ?? childCliKind ?? nestedActivity.cliKind;
      if (!isShellLikeProcessName(command) || nestedActivity.hasRunningSubprocess) {
        hasRunningSubprocess = true;
      }
    }
    return { cliKind, hasNonProviderSubprocess, hasProviderDescendant, hasRunningSubprocess };
  };
  return inspectPid(terminalPid);
}

async function checkPosixSubprocessActivity(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  try {
    const result = await runProcess("pgrep", ["-P", String(terminalPid)], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 32_768,
      outputMode: "truncate",
    });
    if (result.code === 1 || (result.code === 0 && result.stdout.trim().length === 0)) {
      return emptySubprocessActivity();
    }
  } catch {
    // Fall back to ps when pgrep is unavailable.
  }
  const children = await captureProcessChildrenMap();
  return children === null
    ? checkPosixSubprocessActivityByTreeWalk(terminalPid)
    : inspectSubprocessActivity(terminalPid, children);
}

export async function defaultSubprocessChecker(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  if (!Number.isInteger(terminalPid) || terminalPid <= 0) return emptySubprocessActivity();
  return process.platform === "win32"
    ? checkWindowsSubprocessActivity(terminalPid)
    : checkPosixSubprocessActivity(terminalPid);
}
