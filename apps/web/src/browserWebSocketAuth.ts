const TOKEN_REFRESH_SAFETY_MS = 30_000;

type WebSocketTokenResult = {
  readonly token: string;
  readonly expiresAt: string;
};

let browserWebSocketToken: {
  readonly token: string;
  readonly expiresAtMs: number | null;
} | null = null;

export function getBrowserWebSocketToken(): string | null {
  return browserWebSocketToken?.token ?? null;
}

export function setBrowserWebSocketToken(token: string | null): void {
  browserWebSocketToken = token ? { token, expiresAtMs: null } : null;
}

export function setBrowserWebSocketTokenResult(result: WebSocketTokenResult): void {
  const expiresAtMs = Date.parse(result.expiresAt);
  browserWebSocketToken = {
    token: result.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
  };
}

export function shouldRefreshBrowserWebSocketToken(nowMs = Date.now()): boolean {
  if (!browserWebSocketToken) return false;
  return (
    browserWebSocketToken.expiresAtMs === null ||
    browserWebSocketToken.expiresAtMs - nowMs <= TOKEN_REFRESH_SAFETY_MS
  );
}

export async function refreshBrowserWebSocketToken(options?: {
  readonly signal?: AbortSignal;
}): Promise<string | null> {
  if (typeof window === "undefined" || window.desktopBridge) return null;

  const response = await fetch("/api/auth/ws-token", {
    method: "POST",
    credentials: "same-origin",
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`WebSocket authentication failed with status ${response.status}.`);
  }
  const payload = (await response.json()) as {
    readonly token?: unknown;
    readonly expiresAt?: unknown;
  };
  if (
    typeof payload.token !== "string" ||
    payload.token.length === 0 ||
    typeof payload.expiresAt !== "string"
  ) {
    throw new Error("WebSocket authentication returned an invalid token.");
  }
  setBrowserWebSocketTokenResult({ token: payload.token, expiresAt: payload.expiresAt });
  return payload.token;
}
