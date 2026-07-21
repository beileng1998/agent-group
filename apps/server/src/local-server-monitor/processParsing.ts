// FILE: local-server-monitor/processParsing.ts
// Purpose: Parses lsof/ps output and derives stable process-lineage command text.
// Layer: Pure local-server discovery parsing.

import path from "node:path";

import {
  PROCESS_LINEAGE_MAX_DEPTH,
  type LocalServerProcessInfo,
  type ParsedLsofListener,
} from "./types";

const MAX_PROCESS_ARGS_CHARS = 1_000;

function redactProcessArgs(args: string): string {
  return args
    .replace(
      /(--?(?:api[-_]?key|auth|authorization|key|password|secret|token)(?:=|\s+))(\S+)/gi,
      "$1[redacted]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .slice(0, MAX_PROCESS_ARGS_CHARS);
}

function parseLsofEndpoint(
  name: string,
  protocol: ParsedLsofListener["protocol"],
): Pick<ParsedLsofListener, "host" | "port" | "family"> | null {
  const cleaned = name.replace(/\s+\(LISTEN\)$/i, "").trim();
  const bracketMatch = /^\[([^\]]+)\]:(\d+)$/.exec(cleaned);
  if (bracketMatch) {
    const port = Number(bracketMatch[2]);
    return Number.isInteger(port) && port > 0 && port <= 65_535
      ? { host: bracketMatch[1] ?? "::", port, family: "tcp6" }
      : null;
  }

  const separatorIndex = cleaned.lastIndexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const rawHost = cleaned.slice(0, separatorIndex).trim();
  const rawPort = cleaned.slice(separatorIndex + 1).trim();
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return null;
  }

  const host = rawHost.length > 0 ? rawHost : "*";
  return {
    host,
    port,
    family: host.includes(":") ? "tcp6" : protocol === "tcp" && host === "*" ? "tcp" : "tcp4",
  };
}

// Parses `lsof -F pcPn` listener records into one row per listening address.
export function parseLsofTcpListenOutput(output: string): ParsedLsofListener[] {
  const listeners: ParsedLsofListener[] = [];
  let currentPid: number | null = null;
  let currentCommand = "";
  let currentProtocol: ParsedLsofListener["protocol"] = "tcp";

  for (const rawLine of output.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (line.length < 2) {
      continue;
    }

    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      const pid = Number(value);
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
      currentCommand = "";
      currentProtocol = "tcp";
      continue;
    }
    if (field === "c") {
      currentCommand = value.trim();
      continue;
    }
    if (field === "P") {
      currentProtocol = "tcp";
      continue;
    }
    if (field !== "n" || currentPid === null) {
      continue;
    }

    const endpoint = parseLsofEndpoint(value, currentProtocol);
    if (!endpoint) {
      continue;
    }
    listeners.push({
      pid: currentPid,
      command: currentCommand || "unknown",
      protocol: currentProtocol,
      ...endpoint,
    });
  }

  return listeners;
}

// Parses `lsof -d cwd -Fn` records into a pid -> working-directory map. Each
// process appears as a `p<pid>` line followed by an `n<path>` line for its cwd.
export function parseLsofCwdOutput(output: string): Map<number, string> {
  const cwdByPid = new Map<number, string>();
  let currentPid: number | null = null;
  for (const rawLine of output.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (line.length < 2) {
      continue;
    }
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      const pid = Number(value);
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
      continue;
    }
    if (field !== "n" || currentPid === null) {
      continue;
    }
    const cwd = value.trim();
    if (cwd.length > 0 && !cwdByPid.has(currentPid)) {
      cwdByPid.set(currentPid, cwd);
    }
  }
  return cwdByPid;
}

export function parseProcessInfo(output: string): Map<number, LocalServerProcessInfo> {
  const rows = new Map<number, LocalServerProcessInfo>();
  for (const line of output.split(/\r?\n/g)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    rows.set(Number(match[1]), {
      ppid: Number(match[2]),
      commandLine: redactProcessArgs(match[3] ?? ""),
    });
  }
  return rows;
}

function tokenizeCommandLine(commandLine: string): string[] {
  return [...commandLine.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((token) => token.length > 0);
}

export function normalizeCommandName(command: string, args: string): string {
  const firstToken = tokenizeCommandLine(args)[0] ?? command;
  return path
    .basename(firstToken || command)
    .replace(/\.[cm]?js$/i, "")
    .toLowerCase();
}

// Some dev tools let a generic child own the port while the parent has the useful command.
export function processLineageCommandLines(
  pid: number,
  processInfoByPid: ReadonlyMap<number, LocalServerProcessInfo>,
): string | null {
  const commandLines: string[] = [];
  const seen = new Set<number>();
  let currentPid = pid;

  for (let depth = 0; depth < PROCESS_LINEAGE_MAX_DEPTH; depth++) {
    if (seen.has(currentPid)) {
      break;
    }
    seen.add(currentPid);

    const processInfo = processInfoByPid.get(currentPid);
    if (!processInfo) {
      break;
    }
    if (processInfo.commandLine) {
      commandLines.push(processInfo.commandLine);
    }
    if (processInfo.ppid <= 1) {
      break;
    }
    currentPid = processInfo.ppid;
  }

  return commandLines.length > 0 ? commandLines.join(" ") : null;
}
