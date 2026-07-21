// FILE: local-server-monitor/processProjection.ts
// Purpose: Projects parsed listener and process data into UI-ready server rows.
// Layer: Local-server discovery domain projection.

import type { ServerLocalServerAddress, ServerLocalServerProcess } from "@agent-group/contracts";

import { formatDisplayName, isLikelyDevServerProcess } from "./processClassification";
import { processLineageCommandLines } from "./processParsing";
import {
  PROCESS_LINEAGE_MAX_DEPTH,
  type LocalServerProcessInfo,
  type ParsedLsofListener,
} from "./types";

function addressUrl(address: Omit<ServerLocalServerAddress, "url">): string | null {
  if (address.port <= 0) {
    return null;
  }
  if (address.host === "*" || address.host === "0.0.0.0" || address.host === "::") {
    return `http://localhost:${address.port}`;
  }
  if (address.host.includes(":")) {
    return `http://[${address.host}]:${address.port}`;
  }
  return `http://${address.host}:${address.port}`;
}

function isProcessSignalable(pid: number): boolean {
  if (pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function dedupeAddresses(listeners: readonly ParsedLsofListener[]): ServerLocalServerAddress[] {
  const seen = new Set<string>();
  const addresses: ServerLocalServerAddress[] = [];
  for (const listener of listeners) {
    const key = `${listener.family}:${listener.host}:${listener.port}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const baseAddress = {
      host: listener.host,
      port: listener.port,
      family: listener.family,
    };
    addresses.push({
      ...baseAddress,
      url: addressUrl(baseAddress),
    });
  }
  return addresses.toSorted(
    (left, right) => left.port - right.port || left.host.localeCompare(right.host),
  );
}

// Resolves the working directory for a listener, walking up the process lineage
// when the listening pid itself has no resolvable cwd (e.g. a generic child that
// inherited the dev tool's directory). Mirrors how command lines are resolved.
function resolveProcessCwd(
  pid: number,
  processInfoByPid: ReadonlyMap<number, LocalServerProcessInfo>,
  cwdByPid: ReadonlyMap<number, string>,
): string | null {
  const seen = new Set<number>();
  let currentPid = pid;
  for (let depth = 0; depth < PROCESS_LINEAGE_MAX_DEPTH; depth++) {
    if (seen.has(currentPid)) {
      break;
    }
    seen.add(currentPid);
    const cwd = cwdByPid.get(currentPid);
    if (cwd) {
      return cwd;
    }
    const ppid = processInfoByPid.get(currentPid)?.ppid;
    if (typeof ppid !== "number" || ppid <= 1) {
      break;
    }
    currentPid = ppid;
  }
  return null;
}

function toServerProcess(
  pid: number,
  listeners: readonly ParsedLsofListener[],
  processInfoByPid: ReadonlyMap<number, LocalServerProcessInfo>,
  cwdByPid: ReadonlyMap<number, string>,
): ServerLocalServerProcess | null {
  if (pid === process.pid) {
    return null;
  }

  const addresses = dedupeAddresses(listeners);
  const ports = [...new Set(addresses.map((address) => address.port))].toSorted(
    (left, right) => left - right,
  );
  const command = listeners[0]?.command ?? "unknown";
  const processInfo = processInfoByPid.get(pid);
  const args = processInfo?.commandLine ?? command;
  const detectionArgs = processLineageCommandLines(pid, processInfoByPid) ?? args;
  if (!isLikelyDevServerProcess({ command, args: detectionArgs, ports })) {
    return null;
  }

  const isStoppable = isProcessSignalable(pid);
  const cwd = resolveProcessCwd(pid, processInfoByPid, cwdByPid);
  return {
    id: `${pid}:${ports.join(",")}`,
    pid,
    ...(typeof processInfo?.ppid === "number" && processInfo.ppid > 0
      ? { ppid: processInfo.ppid }
      : {}),
    command,
    displayName: formatDisplayName(command, detectionArgs),
    ...(cwd ? { cwd } : {}),
    args,
    ports,
    addresses,
    isStoppable,
    ...(isStoppable ? {} : { stopDisabledReason: "Agent Group cannot signal this process." }),
  };
}

function groupListenersByPid(
  listeners: readonly ParsedLsofListener[],
): Map<number, ParsedLsofListener[]> {
  const grouped = new Map<number, ParsedLsofListener[]>();
  for (const listener of listeners) {
    const group = grouped.get(listener.pid) ?? [];
    group.push(listener);
    grouped.set(listener.pid, group);
  }
  return grouped;
}

// Builds UI-ready process rows from raw listener rows; exported for focused parser tests.
export function buildLocalServerProcesses(
  listeners: readonly ParsedLsofListener[],
  processInfoByPid: ReadonlyMap<number, LocalServerProcessInfo> = new Map(),
  cwdByPid: ReadonlyMap<number, string> = new Map(),
): ServerLocalServerProcess[] {
  const grouped = groupListenersByPid(listeners);
  const processes: ServerLocalServerProcess[] = [];
  for (const [pid, group] of grouped) {
    const processRow = toServerProcess(pid, group, processInfoByPid, cwdByPid);
    if (processRow) {
      processes.push(processRow);
    }
  }
  return processes.toSorted(
    (left, right) => (left.ports[0] ?? 0) - (right.ports[0] ?? 0) || left.pid - right.pid,
  );
}
