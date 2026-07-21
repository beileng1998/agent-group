import { execFile } from "node:child_process";

import { WS_METHODS, type ServerDiagnosticsResult } from "@agent-group/contracts";
import { Effect } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import type { WsRpcHandlers } from "./types";

const MAX_DIAGNOSTIC_CHILD_PROCESSES = 80;
const MAX_DIAGNOSTIC_ARGS_CHARS = 500;

interface ProcessTableRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly virtualSizeBytes: number;
  readonly command: string;
  readonly args: string;
}

function truncateDiagnosticText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 15))}... [truncated]` : value;
}

function redactProcessArgs(args: string): string {
  const redacted = args
    .replace(
      /(--?(?:api[-_]?key|auth|authorization|key|password|secret|token)(?:=|\s+))(\S+)/gi,
      "$1[redacted]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  return truncateDiagnosticText(redacted, MAX_DIAGNOSTIC_ARGS_CHARS);
}

function parseProcessTable(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      virtualSizeBytes: Number(match[4]) * 1024,
      command: match[5] ?? "",
      args: redactProcessArgs(match[6] ?? ""),
    });
  }
  return rows;
}

function collectDescendantProcesses(
  rows: readonly ProcessTableRow[],
  rootPid: number,
): ProcessTableRow[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row);
    childrenByParent.set(row.ppid, children);
  }
  const descendants: ProcessTableRow[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop()!;
    descendants.push(row);
    stack.push(...(childrenByParent.get(row.pid) ?? []));
  }
  return descendants.toSorted((left, right) => right.rssBytes - left.rssBytes);
}

function readDescendantProcesses(rootPid: number): Promise<ProcessTableRow[]> {
  if (process.platform === "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,vsz=,comm=,args="],
      { maxBuffer: 2 * 1024 * 1024 },
      (_error, stdout) => resolve(collectDescendantProcesses(parseProcessTable(stdout), rootPid)),
    );
  });
}

export function makeDiagnosticsHandlers(dependencies: {
  readonly projectionReadModelQuery: typeof ProjectionSnapshotQuery.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, import("@agent-group/contracts").WsRpcError, R>;
}) {
  return {
    [WS_METHODS.serverGetDiagnostics]: () =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const [projection, fullChildProcesses] = yield* Effect.all([
            dependencies.projectionReadModelQuery.getCounts(),
            Effect.promise(() => readDescendantProcesses(process.pid)),
          ]);
          const childProcesses = fullChildProcesses.slice(0, MAX_DIAGNOSTIC_CHILD_PROCESSES);
          const memory = process.memoryUsage();
          const diagnostics: ServerDiagnosticsResult = {
            generatedAt: new Date().toISOString(),
            process: {
              pid: process.pid,
              uptimeSeconds: Math.max(0, Math.round(process.uptime())),
              memory: {
                rssBytes: Math.max(0, Math.round(memory.rss)),
                heapTotalBytes: Math.max(0, Math.round(memory.heapTotal)),
                heapUsedBytes: Math.max(0, Math.round(memory.heapUsed)),
                externalBytes: Math.max(0, Math.round(memory.external)),
                arrayBuffersBytes: Math.max(0, Math.round(memory.arrayBuffers)),
              },
            },
            childProcesses,
            childProcessTotalCount: fullChildProcesses.length,
            childProcessTotalRssBytes: fullChildProcesses.reduce(
              (total, processRow) => total + processRow.rssBytes,
              0,
            ),
            projection,
          };
          return diagnostics;
        }),
        "Failed to load server diagnostics",
      ),
  } satisfies Partial<WsRpcHandlers>;
}
