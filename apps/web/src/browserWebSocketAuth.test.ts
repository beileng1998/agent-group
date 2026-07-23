import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserWebSocketToken,
  refreshBrowserWebSocketToken,
  setBrowserWebSocketToken,
  setBrowserWebSocketTokenResult,
  shouldRefreshBrowserWebSocketToken,
} from "./browserWebSocketAuth";

describe("browser WebSocket authentication", () => {
  afterEach(() => {
    setBrowserWebSocketToken(null);
    vi.unstubAllGlobals();
  });

  it("exchanges the browser session cookie for a short-lived WebSocket token", async () => {
    vi.stubGlobal("window", { desktopBridge: undefined });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "signed-websocket-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshBrowserWebSocketToken()).resolves.toBe("signed-websocket-token");
    expect(getBrowserWebSocketToken()).toBe("signed-websocket-token");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/ws-token", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("reuses a token until it approaches expiry", () => {
    setBrowserWebSocketTokenResult({
      token: "signed-websocket-token",
      expiresAt: "2030-01-01T00:01:00.000Z",
    });

    expect(shouldRefreshBrowserWebSocketToken(Date.parse("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(shouldRefreshBrowserWebSocketToken(Date.parse("2030-01-01T00:00:31.000Z"))).toBe(true);
  });
});
