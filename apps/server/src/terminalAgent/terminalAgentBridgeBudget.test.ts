import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TerminalAgentBridgeServer,
  type TerminalAgentBridgeResourceLimits,
} from "./terminalAgentBridgeServer";

interface BridgeResponse {
  readonly status: number | undefined;
}

const bridges: TerminalAgentBridgeServer[] = [];
const tempDirs: string[] = [];

async function makeBridge(input: {
  readonly handlerTimeoutMs?: number;
  readonly limits: TerminalAgentBridgeResourceLimits;
}): Promise<TerminalAgentBridgeServer> {
  const stateDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "agent-group-bridge-budget-"),
  );
  tempDirs.push(stateDir);
  const bridge = new TerminalAgentBridgeServer(
    stateDir,
    process.platform,
    input.handlerTimeoutMs,
    undefined,
    input.limits,
  );
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}

function hookBody(runtimeInstanceId: string, input: unknown = {}): string {
  return JSON.stringify({ runtimeInstanceId, input });
}

function requestBridge(input: {
  readonly bridge: TerminalAgentBridgeServer;
  readonly token: string;
  readonly body: string;
  readonly chunked?: boolean;
}): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: input.bridge.endpoint,
        path: "/hook",
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
          ...(input.chunked
            ? {}
            : { "content-length": Buffer.byteLength(input.body) }),
        },
      },
      (incoming) => {
        incoming.resume();
        incoming.once("end", () => resolve({ status: incoming.statusCode }));
      },
    );
    request.once("error", reject);
    request.end(input.body);
  });
}

afterEach(async () => {
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("TerminalAgentBridgeServer pending request budgets", () => {
  it("bounds optional event and mode identifiers before dispatch", async () => {
    const bridge = await makeBridge({
      limits: { maxPendingRequests: 2, maxPendingBodyBytes: 1024 },
    });
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    const request = (field: "eventId" | "mode", value: string) =>
      requestBridge({
        bridge,
        token: registration.token,
        body: JSON.stringify({ runtimeInstanceId: "runtime-1", [field]: value }),
      });

    await expect(request("eventId", "x".repeat(257))).resolves.toEqual({
      status: 400,
    });
    await expect(request("mode", "x".repeat(65))).resolves.toEqual({
      status: 400,
    });
    expect(handled).toBe(0);
  });

  it("rejects a full request queue and recovers after the pending request settles", async () => {
    const bridge = await makeBridge({
      limits: { maxPendingRequests: 1, maxPendingBodyBytes: 1024 },
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    let block = true;
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      started = true;
      if (block) await gate;
      return {};
    });
    const body = hookBody("runtime-1");
    const pending = requestBridge({
      bridge,
      token: registration.token,
      body,
    });
    while (!started) await new Promise((resolve) => setTimeout(resolve, 1));

    await expect(
      requestBridge({ bridge, token: registration.token, body }),
    ).resolves.toEqual({ status: 429 });
    block = false;
    release();
    await expect(pending).resolves.toEqual({ status: 200 });
    await expect(
      requestBridge({ bridge, token: registration.token, body }),
    ).resolves.toEqual({ status: 200 });
    expect(handled).toBe(2);
  });

  it("reserves declared body bytes before reading and restores the byte budget", async () => {
    const largeBody = hookBody("runtime-1", "x".repeat(200));
    const bridge = await makeBridge({
      limits: {
        maxPendingRequests: 2,
        maxPendingBodyBytes: Buffer.byteLength(largeBody) + 8,
      },
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    let block = true;
    const registration = bridge.register("runtime-1", async () => {
      started = true;
      if (block) await gate;
      return {};
    });
    const pending = requestBridge({
      bridge,
      token: registration.token,
      body: largeBody,
    });
    while (!started) await new Promise((resolve) => setTimeout(resolve, 1));

    await expect(
      requestBridge({ bridge, token: registration.token, body: largeBody }),
    ).resolves.toEqual({ status: 429 });
    block = false;
    release();
    await expect(pending).resolves.toEqual({ status: 200 });
    await expect(
      requestBridge({ bridge, token: registration.token, body: largeBody }),
    ).resolves.toEqual({ status: 200 });
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1", "x".repeat(400)),
        chunked: true,
      }),
    ).resolves.toEqual({ status: 429 });
    await expect(
      requestBridge({ bridge, token: registration.token, body: largeBody }),
    ).resolves.toEqual({ status: 200 });
  });

  it("releases the budget after parse and handler failures", async () => {
    const bridge = await makeBridge({
      limits: { maxPendingRequests: 1, maxPendingBodyBytes: 1024 },
    });
    let failHandler = true;
    const registration = bridge.register("runtime-1", async () => {
      if (failHandler) throw new Error("expected failure");
      return {};
    });

    await expect(
      requestBridge({ bridge, token: registration.token, body: "{" }),
    ).resolves.toEqual({ status: 400 });
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toEqual({ status: 503 });
    failHandler = false;
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toEqual({ status: 200 });
  });

  it("releases the budget after a timed-out handler observes abort", async () => {
    const bridge = await makeBridge({
      handlerTimeoutMs: 20,
      limits: { maxPendingRequests: 1, maxPendingBodyBytes: 1024 },
    });
    let calls = 0;
    const registration = bridge.register("runtime-1", async (_request, signal) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return {};
    });
    const body = hookBody("runtime-1");

    await expect(
      requestBridge({ bridge, token: registration.token, body }),
    ).resolves.toEqual({ status: 503 });
    await expect(
      requestBridge({ bridge, token: registration.token, body }),
    ).resolves.toEqual({ status: 200 });
    expect(calls).toBe(2);
  });

  it("releases a body reservation when the client aborts while uploading", async () => {
    const bridge = await makeBridge({
      limits: { maxPendingRequests: 1, maxPendingBodyBytes: 1024 },
    });
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    const body = hookBody("runtime-1", "x".repeat(100));
    const partial = http.request({
      socketPath: bridge.endpoint,
      path: "/hook",
      method: "POST",
      headers: {
        authorization: `Bearer ${registration.token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    });
    partial.on("error", () => {});
    partial.write(body.slice(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toEqual({ status: 429 });
    partial.destroy();

    let recovered: BridgeResponse | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recovered = await requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      });
      if (recovered.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(recovered).toEqual({ status: 200 });
    expect(handled).toBe(1);
  });
});
