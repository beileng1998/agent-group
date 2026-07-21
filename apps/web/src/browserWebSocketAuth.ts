let browserWebSocketToken: string | null = null;

export function getBrowserWebSocketToken(): string | null {
  return browserWebSocketToken;
}

export function setBrowserWebSocketToken(token: string | null): void {
  browserWebSocketToken = token;
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
  const payload = (await response.json()) as { readonly token?: unknown };
  if (typeof payload.token !== "string" || payload.token.length === 0) {
    throw new Error("WebSocket authentication returned an invalid token.");
  }
  browserWebSocketToken = payload.token;
  return browserWebSocketToken;
}
