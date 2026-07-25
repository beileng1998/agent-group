import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupBridges,
  hookBody,
  makeBridge,
  requestBridge,
} from "./terminalAgentBridgeServer.testSupport";

afterEach(cleanupBridges);

describe("TerminalAgentBridgeServer request limits", () => {
  it("closes a valid-token request whose body stalls", async () => {
    const bridge = await makeBridge(30);
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    const closed = new Promise<void>((resolve, reject) => {
      const request = http.request({
        socketPath: bridge.endpoint,
        path: "/hook",
        method: "POST",
        headers: {
          authorization: `Bearer ${registration.token}`,
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
      });
      const timer = setTimeout(() => {
        request.destroy();
        reject(new Error("stalled bridge request was not closed"));
      }, 1_000);
      request.on("error", () => {});
      request.on("socket", (socket) => socket.on("error", () => {}));
      request.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      request.write('{"run', () => {});
    });

    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handled).toBe(0);
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rejects invalid JSON, oversized bodies, and oversized runtime ids", async () => {
    const bridge = await makeBridge();
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    const nearLimitBody = hookBody("runtime-1", "x".repeat(1_048_000));

    expect(Buffer.byteLength(nearLimitBody)).toBeLessThanOrEqual(1024 * 1024);
    const nearLimit = await requestBridge({
      bridge,
      token: registration.token,
      body: nearLimitBody,
    });
    const invalid = await requestBridge({
      bridge,
      token: registration.token,
      body: "{",
    });
    const oversized = await requestBridge({
      bridge,
      token: registration.token,
      body: JSON.stringify({
        runtimeInstanceId: "runtime-1",
        input: "x".repeat(1024 * 1024),
      }),
    });
    const oversizedRuntimeId = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("x".repeat(129)),
    });

    expect(nearLimit.status).toBe(200);
    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(oversizedRuntimeId.status).toBe(400);
    expect(handled).toBe(1);
  });

  it("rate-limits each registered runtime independently", async () => {
    const bridge = await makeBridge();
    let firstHandled = 0;
    let secondHandled = 0;
    const first = bridge.register("runtime-1", async () => {
      firstHandled += 1;
      return {};
    });
    const second = bridge.register("runtime-2", async () => {
      secondHandled += 1;
      return {};
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    try {
      for (let index = 0; index < 240; index += 1) {
        const response = await requestBridge({
          bridge,
          token: first.token,
          body: hookBody("runtime-1"),
          agent,
        });
        expect(response.status).toBe(200);
      }
      const limited = await requestBridge({
        bridge,
        token: first.token,
        body: hookBody("runtime-1"),
        agent,
      });
      const independent = await requestBridge({
        bridge,
        token: second.token,
        body: hookBody("runtime-2"),
        agent,
      });

      expect(limited.status).toBe(429);
      expect(independent.status).toBe(200);
      expect(firstHandled).toBe(240);
      expect(secondHandled).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  it("does not expose handler failures or unsupported routes", async () => {
    const bridge = await makeBridge();
    const registration = bridge.register("runtime-1", async () => {
      throw new Error("sensitive handler detail");
    });

    const failed = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });
    const missing = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
      requestPath: "/other",
    });

    expect(failed.status).toBe(503);
    expect(failed.body).not.toContain("sensitive handler detail");
    expect(missing.status).toBe(404);
  });

  it("finishes the request deadline even when a handler ignores abort", async () => {
    const bridge = await makeBridge(20);
    const registration = bridge.register(
      "runtime-1",
      () => new Promise(() => {}),
    );

    const response = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });

    expect(response.status).toBe(503);
  });
});
