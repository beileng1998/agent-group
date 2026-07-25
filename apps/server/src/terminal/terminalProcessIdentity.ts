// FILE: terminalProcessIdentity.ts
// Purpose: Capture and compare durable PTY-owner identities across server restarts.
// Layer: Managed terminal process safety

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  processIdentitySnapshotFromPsResult,
  type CapturedProcessIdentity,
} from "./processTreeKiller";

const PROCESS_INSPECTION_TIMEOUT_MS = 1_000;
const PROCESS_INSPECTION_MAX_BUFFER_BYTES = 262_144;

export interface TerminalOwnerIdentity {
  readonly pid: number;
  readonly startTime: string;
  readonly commandFingerprint: string;
}

export type TerminalOwnerInspection =
  | {
      readonly presence: "alive";
      readonly identity: TerminalOwnerIdentity;
      readonly detail: null;
    }
  | {
      readonly presence: "absent";
      readonly detail: null;
    }
  | {
      readonly presence: "unverified";
      readonly detail: string;
    };

export type CapturedProcessInspection =
  | { readonly presence: "alive"; readonly identity: CapturedProcessIdentity }
  | { readonly presence: "absent" }
  | { readonly presence: "unverified"; readonly detail: string };

function fingerprintCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

export function terminalOwnerIdentityFromCaptured(
  identity: CapturedProcessIdentity,
): TerminalOwnerIdentity {
  return {
    pid: identity.pid,
    startTime: identity.startTime,
    commandFingerprint: fingerprintCommand(identity.command),
  };
}

function fallbackPidPresence(pid: number): CapturedProcessInspection {
  try {
    process.kill(pid, 0);
    return {
      presence: "unverified",
      detail: `Process ${pid} exists but its stable identity could not be read.`,
    };
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { presence: "absent" };
    return {
      presence: "unverified",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function inspectPosixProcess(pid: number): CapturedProcessInspection {
  try {
    const result = spawnSync(
      "ps",
      ["-p", String(pid), "-o", "pid=,lstart=,command="],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        maxBuffer: PROCESS_INSPECTION_MAX_BUFFER_BYTES,
        timeout: PROCESS_INSPECTION_TIMEOUT_MS,
      },
    );
    const identities = processIdentitySnapshotFromPsResult(result);
    if (identities === null) return fallbackPidPresence(pid);
    const identity = identities.get(pid);
    return identity
      ? {
          presence: "alive",
          identity: { pid, ...identity },
        }
      : { presence: "absent" };
  } catch (cause) {
    return {
      presence: "unverified",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function inspectWindowsProcess(pid: number): CapturedProcessInspection {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
    "if($null -eq $p){exit 3}",
    "$command=if($p.CommandLine){$p.CommandLine}elseif($p.ExecutablePath){$p.ExecutablePath}else{$p.Name}",
    "[ordered]@{pid=[int]$p.ProcessId;startTime=$p.CreationDate.ToUniversalTime().ToString('O');command=[string]$command}|ConvertTo-Json -Compress",
  ].join(";");
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        maxBuffer: PROCESS_INSPECTION_MAX_BUFFER_BYTES,
        timeout: PROCESS_INSPECTION_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    if (result.status === 3) return { presence: "absent" };
    if (result.error || result.status !== 0) {
      return fallbackPidPresence(pid);
    }
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    if (
      parsed.pid !== pid ||
      typeof parsed.startTime !== "string" ||
      parsed.startTime.length === 0 ||
      typeof parsed.command !== "string" ||
      parsed.command.length === 0
    ) {
      return {
        presence: "unverified",
        detail: `Process ${pid} returned an invalid Windows identity.`,
      };
    }
    return {
      presence: "alive",
      identity: {
        pid,
        startTime: parsed.startTime,
        command: parsed.command,
      },
    };
  } catch (cause) {
    return {
      presence: "unverified",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function inspectTerminalOwner(
  pid: number,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly inspectProcess?: (pid: number) => CapturedProcessInspection;
  } = {},
): TerminalOwnerInspection {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return {
      presence: "unverified",
      detail: `Persisted terminal PID ${pid} is invalid.`,
    };
  }
  const platform = options.platform ?? process.platform;
  const inspected =
    options.inspectProcess?.(pid) ??
    (platform === "win32"
      ? inspectWindowsProcess(pid)
      : inspectPosixProcess(pid));
  if (inspected.presence === "absent") {
    return { presence: "absent", detail: null };
  }
  if (inspected.presence === "unverified") {
    return inspected;
  }
  return {
    presence: "alive",
    identity: terminalOwnerIdentityFromCaptured(inspected.identity),
    detail: null,
  };
}

export function captureTerminalOwnerIdentity(
  pid: number,
  options: Parameters<typeof inspectTerminalOwner>[1] = {},
): TerminalOwnerIdentity {
  const inspected = inspectTerminalOwner(pid, options);
  if (inspected.presence !== "alive") {
    throw new Error(
      inspected.presence === "unverified"
        ? inspected.detail
        : `Terminal process ${pid} exited before its owner identity was captured.`,
    );
  }
  return inspected.identity;
}

export function terminalOwnerIdentityMatches(
  expected: TerminalOwnerIdentity,
  actual: TerminalOwnerIdentity,
): boolean {
  return (
    expected.pid === actual.pid &&
    expected.startTime === actual.startTime &&
    expected.commandFingerprint === actual.commandFingerprint
  );
}
