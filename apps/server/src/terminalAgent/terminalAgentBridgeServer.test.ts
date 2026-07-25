import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupBridges,
  hookBody,
  makeBridge,
  requestBridge,
  type BridgeResponse,
} from "./terminalAgentBridgeServer.testSupport";

afterEach(cleanupBridges);

describe("TerminalAgentBridgeServer authentication and runtime fences", () => {
  it("rejects missing and unknown bearer tokens without invoking a runtime", async () => {
    const bridge = await makeBridge();
    let handled = 0;
    bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });

    const missing = await requestBridge({
      bridge,
      body: "{",
    });
    const unknown = await requestBridge({
      bridge,
      token: "not-a-registration-token",
      body: hookBody("runtime-1"),
    });

    expect(missing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(missing.cacheControl).toBe("no-store");
    expect(handled).toBe(0);
  });

  it("binds each token to exactly one runtime instance", async () => {
    const bridge = await makeBridge();
    const seen: unknown[] = [];
    const registration = bridge.register("runtime-1", async (request) => {
      seen.push(request);
      return { turnId: "turn-1" };
    });

    const stale = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-2"),
    });
    const current = await requestBridge({
      bridge,
      token: registration.token,
      body: JSON.stringify({
        runtimeInstanceId: " runtime-1 ",
        eventId: " event-1 ",
        mode: " prompt_submit ",
        input: { prompt: "hello" },
      }),
    });

    expect(stale.status).toBe(409);
    expect(current.status).toBe(200);
    expect(seen).toEqual([
      {
        runtimeInstanceId: "runtime-1",
        eventId: "event-1",
        mode: "prompt_submit",
        input: { prompt: "hello" },
      },
    ]);
  });

  it("rejects requests after unregister", async () => {
    const bridge = await makeBridge();
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    registration.unregister();

    const response = await requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });

    expect(response.status).toBe(401);
    expect(handled).toBe(0);
  });

  it("rejects a request whose body completes after unregister", async () => {
    const bridge = await makeBridge();
    let handled = 0;
    const registration = bridge.register("runtime-1", async () => {
      handled += 1;
      return {};
    });
    const body = hookBody("runtime-1", { prompt: "hello" });

    const response = new Promise<BridgeResponse>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: bridge.endpoint,
          path: "/hook",
          method: "POST",
          headers: {
            authorization: `Bearer ${registration.token}`,
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
      const split = Math.floor(body.length / 2);
      request.write(body.slice(0, split));
      setTimeout(() => {
        registration.unregister();
        request.end(body.slice(split));
      }, 10);
    });

    await expect(response).resolves.toMatchObject({ status: 409 });
    expect(handled).toBe(0);
  });

  it("serializes hook events for each runtime", async () => {
    const bridge = await makeBridge();
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const registration = bridge.register("runtime-1", async (request) => {
      const eventId = request.eventId ?? "missing";
      order.push(`start:${eventId}`);
      if (eventId === "first") await firstGate;
      order.push(`end:${eventId}`);
      return {};
    });
    const request = (eventId: string) =>
      requestBridge({
        bridge,
        token: registration.token,
        body: JSON.stringify({
          runtimeInstanceId: "runtime-1",
          eventId,
          input: {},
        }),
      });

    const first = request("first");
    while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = request("second");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["start:first"]);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]);
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("aborts an in-flight hook when its runtime is unregistered", async () => {
    const bridge = await makeBridge();
    let started = false;
    let observedAbort = false;
    const registration = bridge.register("runtime-1", async (_request, signal) => {
      started = true;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
      return {};
    });
    const response = requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });
    while (!started) await new Promise((resolve) => setTimeout(resolve, 1));

    registration.unregister();

    await expect(response).resolves.toMatchObject({ status: 503 });
    expect(observedAbort).toBe(true);
  });

  it("quiesces active hooks and can resume the same registration after rollback", async () => {
    const bridge = await makeBridge();
    let block = true;
    const registration = bridge.register("runtime-1", async (_request, signal) => {
      if (block) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("paused")), {
            once: true,
          });
        });
      }
      return {};
    });
    const active = requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await registration.pause();
    await expect(active).resolves.toMatchObject({ status: 503 });
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 409 });

    block = false;
    registration.resume();
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("does not advance the event queue when a hook ignores cancellation", async () => {
    const bridge = await makeBridge(30, 20);
    let started = false;
    let calls = 0;
    const registration = bridge.register("runtime-1", async () => {
      calls += 1;
      started = true;
      return calls === 1 ? new Promise(() => {}) : {};
    });
    const active = requestBridge({
      bridge,
      token: registration.token,
      body: hookBody("runtime-1"),
    });
    while (!started) await new Promise((resolve) => setTimeout(resolve, 1));

    await expect(registration.pause()).rejects.toThrow("quiesce timed out");
    await expect(active).resolves.toMatchObject({ status: 503 });
    registration.resume();
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });

  it("starts operation cancellation when the response deadline expires", async () => {
    const bridge = await makeBridge(20);
    let cancelled = false;
    const registration = bridge.register("runtime-1", () => ({
      result: new Promise(() => {}),
      cancel: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        cancelled = true;
      },
    }));

    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 503 });
    while (!cancelled) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(cancelled).toBe(true);
  });

  it("bounds the response but keeps the queue closed when cancellation hangs", async () => {
    const bridge = await makeBridge(20);
    let calls = 0;
    const registration = bridge.register("runtime-1", () => {
      calls += 1;
      return calls === 1
        ? {
            result: new Promise(() => {}),
            cancel: () => new Promise(() => {}),
          }
        : { result: Promise.resolve({}) };
    });

    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      requestBridge({
        bridge,
        token: registration.token,
        body: hookBody("runtime-1"),
      }),
    ).resolves.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });
});
