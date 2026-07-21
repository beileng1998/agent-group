// FILE: local-server-monitor/runtime.ts
// Purpose: Discovers and stops local development servers through lsof/ps and process signals.
// Layer: Local-server runtime I/O and orchestration.

import { execFile } from "node:child_process";

import type {
  ServerListLocalServersResult,
  ServerLocalServerProcess,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
} from "@agent-group/contracts";

import { enrichLocalServerProcessesWithPageTitles } from "./pageTitles";
import { parseLsofCwdOutput, parseLsofTcpListenOutput, parseProcessInfo } from "./processParsing";
import { buildLocalServerProcesses } from "./processProjection";
import { PROCESS_LINEAGE_MAX_DEPTH, type LocalServerProcessInfo } from "./types";

const PROCESS_OUTPUT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const STOP_SIGNAL_SETTLE_MS = 450;

function execFileText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", maxBuffer: PROCESS_OUTPUT_MAX_BUFFER_BYTES },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function readLsofListeners() {
  if (process.platform === "win32") {
    return [];
  }
  const output = await execFileText("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcPn"]).catch(
    () => "",
  );
  return parseLsofTcpListenOutput(output);
}

async function readProcessInfoBatch(
  pids: readonly number[],
): Promise<Map<number, LocalServerProcessInfo>> {
  if (pids.length === 0 || process.platform === "win32") {
    return new Map();
  }
  const output = await execFileText("ps", [
    "-ww",
    "-o",
    "pid=",
    "-o",
    "ppid=",
    "-o",
    "command=",
    "-p",
    pids.join(","),
  ]).catch(() => "");
  return parseProcessInfo(output);
}

// Resolves each pid's working directory via `lsof -d cwd`. Only user-owned
// processes are reported (which dev servers are); others are silently absent.
async function readProcessCwdBatch(pids: readonly number[]): Promise<Map<number, string>> {
  if (pids.length === 0 || process.platform === "win32") {
    return new Map();
  }
  const output = await execFileText("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")]).catch(
    () => "",
  );
  return parseLsofCwdOutput(output);
}

async function readProcessInfoWithAncestors(
  pids: readonly number[],
): Promise<Map<number, LocalServerProcessInfo>> {
  const allProcessInfo = new Map<number, LocalServerProcessInfo>();
  let pendingPids = [...new Set(pids)].filter((pid) => pid > 1);

  for (let depth = 0; depth < PROCESS_LINEAGE_MAX_DEPTH && pendingPids.length > 0; depth++) {
    const batch = await readProcessInfoBatch(pendingPids);
    const nextPids: number[] = [];
    for (const [pid, processInfo] of batch) {
      allProcessInfo.set(pid, processInfo);
      if (processInfo.ppid > 1 && !allProcessInfo.has(processInfo.ppid)) {
        nextPids.push(processInfo.ppid);
      }
    }
    pendingPids = [...new Set(nextPids)];
  }

  return allProcessInfo;
}

export async function listLocalServers(): Promise<ServerListLocalServersResult> {
  const listeners = await readLsofListeners();
  const pids = [...new Set(listeners.map((listener) => listener.pid))];
  const processInfoByPid = await readProcessInfoWithAncestors(pids);
  // Resolve cwd across the full lineage so a generic port-holding child can fall
  // back to its dev-tool parent's directory (cwd is inherited across fork/exec).
  const cwdByPid = await readProcessCwdBatch([...new Set([...pids, ...processInfoByPid.keys()])]);
  const servers = buildLocalServerProcesses(listeners, processInfoByPid, cwdByPid);
  return {
    generatedAt: new Date().toISOString(),
    servers: await enrichLocalServerProcessesWithPageTitles(servers),
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Revalidates the pid/port before signaling so stale UI rows cannot kill arbitrary processes.
export async function stopLocalServer(
  input: ServerStopLocalServerInput,
  prevalidatedTarget?: ServerLocalServerProcess | null,
): Promise<ServerStopLocalServerResult> {
  const target =
    prevalidatedTarget !== undefined
      ? prevalidatedTarget
      : (await listLocalServers()).servers.find(
          (server) => server.pid === input.pid && server.ports.includes(input.port),
        );

  if (!target) {
    return {
      pid: input.pid,
      stopped: false,
      message: "That local server is no longer running.",
    };
  }
  if (!target.isStoppable) {
    return {
      pid: input.pid,
      stopped: false,
      message: target.stopDisabledReason ?? "Agent Group cannot stop this process.",
    };
  }

  try {
    process.kill(input.pid, "SIGTERM");
  } catch (error) {
    return {
      pid: input.pid,
      stopped: false,
      message: error instanceof Error ? error.message : "Failed to stop the local server.",
    };
  }

  await delay(STOP_SIGNAL_SETTLE_MS);
  const stillAlive = isProcessAlive(input.pid);
  return {
    pid: input.pid,
    stopped: !stillAlive,
    message: stillAlive ? "Stop signal sent; the process is still shutting down." : "Stopped.",
  };
}
