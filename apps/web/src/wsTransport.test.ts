// FILE: wsTransport.test.ts
// Purpose: Verifies browser WebSocket construction around the Effect RPC transport.
// Layer: Web transport tests
// Depends on: the global WebSocket constructor shim and desktop bridge URL contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_CHANNELS } from "@agent-group/contracts";

import {
  setBrowserWebSocketToken,
  setBrowserWebSocketTokenResult,
} from "./browserWebSocketAuth";
import { shouldKeepServerLifecycleStream, WsTransport } from "./wsTransport";
import { reconnectDelayMs } from "./wsTransportSession";

type WsEventType = "open" | "message" | "close" | "error";
type WsEvent = { readonly code?: number; readonly data?: unknown; readonly reason?: string };
type WsListener = (event?: WsEvent) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code: 1000, reason: "" });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  drop() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code: 1006, reason: "network changed" });
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  sockets.length = 0;
  setBrowserWebSocketToken(null);
  vi.stubEnv("VITE_WS_URL", "");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { protocol: "http:", hostname: "localhost", port: "3020" },
      desktopBridge: undefined,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("keeps the shared lifecycle stream while either lifecycle channel is active", () => {
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverWelcome]))).toBe(true);
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverMaintenanceUpdated]))).toBe(
      true,
    );
    expect(
      shouldKeepServerLifecycleStream(
        new Set([WS_CHANNELS.serverWelcome, WS_CHANNELS.serverMaintenanceUpdated]),
      ),
    ).toBe(true);
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverConfigUpdated]))).toBe(false);
  });

  it("normalizes explicit websocket URLs to the RPC endpoint", () => {
    const transport = new WsTransport("ws://localhost:3020");

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws");
    expect(transport.getState()).toBe("connecting");
    sockets[0]?.open();
    expect(transport.getState()).toBe("open");

    transport.dispose();
  });

  it("uses the desktop bridge URL before falling back to the browser location", () => {
    const getWsUrl = vi.fn().mockReturnValue("ws://127.0.0.1:53036/?token=old");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { protocol: "http:", hostname: "localhost", port: "3020" },
        desktopBridge: { getWsUrl },
      },
    });

    const transport = new WsTransport();

    expect(getWsUrl).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:53036/ws?token=old");

    transport.dispose();
  });

  it("falls back to the current browser host when no desktop bridge URL exists", () => {
    const transport = new WsTransport();

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws");

    transport.dispose();
  });

  it("authenticates browser WebSockets with the short-lived session token", () => {
    setBrowserWebSocketToken("signed-websocket-token");

    const transport = new WsTransport();

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws?wsToken=signed-websocket-token");

    transport.dispose();
  });

  it("notifies state listeners and replays the current state on demand", () => {
    const transport = new WsTransport();
    const listener = vi.fn();

    const unsubscribe = transport.onStateChange(listener, { replayCurrent: true });

    expect(listener).toHaveBeenCalledWith("connecting");

    listener.mockClear();
    transport.dispose();

    expect(listener).toHaveBeenCalledWith("disposed");

    listener.mockClear();
    unsubscribe();
    transport.dispose();

    expect(listener).not.toHaveBeenCalled();
  });

  it("refreshes the browser token before opening a replacement socket", async () => {
    setBrowserWebSocketToken("initial-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "refreshed-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport();

    sockets[0]?.open();
    sockets[0]?.drop();
    expect(transport.getState()).toBe("connecting");

    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2_000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/ws-token",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(sockets[1]?.url).toBe("ws://localhost:3020/ws?wsToken=refreshed-token");
    sockets[1]?.open();
    expect(transport.getState()).toBe("open");

    transport.dispose();
  });

  it("reconnects immediately with an unexpired token", async () => {
    setBrowserWebSocketTokenResult({
      token: "still-valid-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport();

    sockets[0]?.open();
    sockets[0]?.drop();

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sockets[1]?.url).toContain("wsToken=still-valid-token");
    transport.dispose();
  });

  it("caps jittered reconnect delays", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(375);
    expect(reconnectDelayMs(0, () => 1)).toBe(625);
    expect(reconnectDelayMs(20, () => 1)).toBe(15_000);
  });
});
