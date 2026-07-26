import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { TerminalAgentBridgeServer } from "./terminalAgentBridgeServer";

export interface BridgeResponse {
  readonly status: number | undefined;
  readonly body: string;
  readonly cacheControl: string | undefined;
}

const bridges: TerminalAgentBridgeServer[] = [];
const tempDirs: string[] = [];

export async function makeBridge(
  handlerTimeoutMs?: number,
  quiesceTimeoutMs?: number,
): Promise<TerminalAgentBridgeServer> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-bridge-"));
  tempDirs.push(stateDir);
  const bridge = new TerminalAgentBridgeServer(
    stateDir,
    process.platform,
    handlerTimeoutMs,
    quiesceTimeoutMs,
  );
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}

export function requestBridge(input: {
  readonly bridge: TerminalAgentBridgeServer;
  readonly token?: string;
  readonly body?: string;
  readonly method?: string;
  readonly requestPath?: string;
  readonly agent?: http.Agent;
}): Promise<BridgeResponse> {
  const body = input.body ?? "{}";
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: input.bridge.endpoint,
        path: input.requestPath ?? "/hook",
        method: input.method ?? "POST",
        agent: input.agent,
        headers: {
          ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
            cacheControl:
              typeof incoming.headers["cache-control"] === "string"
                ? incoming.headers["cache-control"]
                : undefined,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

export function hookBody(runtimeInstanceId: string, input: unknown = {}): string {
  return JSON.stringify({ runtimeInstanceId, input });
}

export async function cleanupBridges(): Promise<void> {
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
}
