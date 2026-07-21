// FILE: wsTransportSession.ts
// Purpose: Own one browser WebSocket session and all reconnect/recovery behavior.
// Layer: Web transport infrastructure
// Exports: WsTransportSession and the session handle consumed by WsTransport.

import { WsRpcGroup } from "@agent-group/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { getBrowserWebSocketToken, refreshBrowserWebSocketToken } from "./browserWebSocketAuth";
import { layerResilientRpcSocketProtocol } from "./resilientRpcSocketProtocol";
import type { WsTransportState } from "./wsTransportEvents";

const OPEN_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_TIMEOUT_MS = 15_000;
const BACKGROUND_RECONNECT_AFTER_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

const makeRpcClient = RpcClient.make(WsRpcGroup);
type RpcClientEffect = typeof makeRpcClient;
type RpcClientInstance =
  RpcClientEffect extends Effect.Effect<infer Client, any, any> ? Client : never;

export type WsSessionHandle = {
  readonly client: RpcClientInstance;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
};

type SessionCallbacks = {
  readonly onStateChange: (state: WsTransportState) => void;
  readonly onBeforeReconnect: () => void;
  readonly onReconnected: (session: WsSessionHandle) => void;
};

export function reconnectDelayMs(failures: number, random = Math.random): number {
  const base = Math.min(500 * 2 ** failures, MAX_RECONNECT_DELAY_MS);
  return Math.min(MAX_RECONNECT_DELAY_MS, Math.round(base * (0.75 + random() * 0.5)));
}

export function shouldReconnectAfterBackground(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= BACKGROUND_RECONNECT_AFTER_MS;
}

function resolveRpcUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.pathname = "/ws";
  return url.toString();
}

function makeSocketUrl(explicitUrl: string | null): string {
  if (explicitUrl) return resolveRpcUrl(explicitUrl);
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const rawUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  const resolvedUrl = new URL(resolveRpcUrl(rawUrl));
  const browserToken = window.desktopBridge ? null : getBrowserWebSocketToken();
  if (browserToken) resolvedUrl.searchParams.set("wsToken", browserToken);
  return resolvedUrl.toString();
}

function isStandaloneWebApp(): boolean {
  if (window.desktopBridge) return false;
  const iosNavigator = navigator as Navigator & { readonly standalone?: boolean };
  return (
    iosNavigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

function makeProtocolLayer(
  url: string,
  callbacks: { readonly onOpen: () => void; readonly onUnavailable: () => void },
) {
  const constructorLayer = Layer.succeed(Socket.WebSocketConstructor)((socketUrl, protocols) => {
    const socket = new globalThis.WebSocket(socketUrl, protocols);
    socket.addEventListener("open", callbacks.onOpen, { once: true });
    socket.addEventListener("close", callbacks.onUnavailable, { once: true });
    socket.addEventListener("error", callbacks.onUnavailable, { once: true });
    return socket;
  });
  const socketLayer = Socket.layerWebSocket(url, { openTimeout: OPEN_TIMEOUT_MS }).pipe(
    Layer.provide(constructorLayer),
  );
  return layerResilientRpcSocketProtocol.pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  );
}

export function isRpcTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly _tag?: unknown; readonly reason?: unknown };
  if (
    candidate._tag !== "RpcClientError" ||
    !candidate.reason ||
    typeof candidate.reason !== "object"
  ) {
    return false;
  }
  const reason = candidate.reason as { readonly _tag?: unknown };
  return (
    reason._tag === "SocketOpenError" ||
    reason._tag === "SocketCloseError" ||
    reason._tag === "SocketReadError"
  );
}

export class WsTransportSession {
  private readonly explicitUrl: string | null;
  private readonly callbacks: SessionCallbacks;
  private sessionVersion = 0;
  private disposed = false;
  private isOpen = false;
  private hiddenAt: number | null = null;
  private reconnectFailures = 0;
  private reconnectPromise: Promise<WsSessionHandle> | null = null;
  private wakeReconnectDelay: (() => void) | null = null;
  private runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
  private clientScope: Scope.Closeable;
  private clientPromise: Promise<WsSessionHandle>;

  constructor(explicitUrl: string | null, callbacks: SessionCallbacks) {
    this.explicitUrl = explicitUrl;
    this.callbacks = callbacks;
    const session = this.createSession();
    this.runtime = session.runtime;
    this.clientScope = session.clientScope;
    this.clientPromise = session.clientPromise;
    void this.clientPromise.catch(() => undefined);
    this.installRecoveryListeners();
  }

  async getSession(): Promise<WsSessionHandle> {
    if (this.reconnectPromise) return this.reconnectPromise;
    try {
      return await this.clientPromise;
    } catch {
      if (this.disposed) throw new Error("Transport disposed");
      return this.reconnect();
    }
  }

  reconnect(): Promise<WsSessionHandle> {
    if (this.disposed) return Promise.reject(new Error("Transport disposed"));
    if (this.reconnectPromise) {
      this.wakeReconnectDelay?.();
      return this.reconnectPromise;
    }

    this.isOpen = false;
    this.callbacks.onStateChange("connecting");
    this.callbacks.onBeforeReconnect();

    const oldRuntime = this.runtime;
    const oldScope = this.clientScope;
    const reconnectPromise = Promise.resolve().then(() => this.openReconnectLoop());
    this.reconnectPromise = reconnectPromise;
    void reconnectPromise
      .finally(() => {
        if (this.reconnectPromise === reconnectPromise) this.reconnectPromise = null;
      })
      .catch(() => undefined);
    this.sessionVersion += 1;
    this.closeSession(oldRuntime, oldScope);
    return reconnectPromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeRecoveryListeners();
    this.wakeReconnectDelay?.();
    void this.clientPromise.catch(() => undefined);
    void this.reconnectPromise?.catch(() => undefined);
    this.closeSession(this.runtime, this.clientScope);
  }

  private createSession() {
    const version = ++this.sessionVersion;
    let opened = false;
    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const openPromise = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    void openPromise.catch(() => undefined);

    const runtime = ManagedRuntime.make(
      makeProtocolLayer(makeSocketUrl(this.explicitUrl), {
        onOpen: () => {
          if (opened) return;
          opened = true;
          resolveOpen();
          if (!this.disposed && version === this.sessionVersion) {
            this.isOpen = true;
            this.callbacks.onStateChange("open");
          }
        },
        onUnavailable: () => {
          if (!opened) rejectOpen(new Error("WebSocket unavailable"));
          if (!this.disposed && version === this.sessionVersion) {
            this.isOpen = false;
            void this.reconnect().catch(() => undefined);
          }
        },
      }),
    );
    const clientScope = runtime.runSync(Scope.make());
    const clientReady = runtime.runPromise(Scope.provide(clientScope)(makeRpcClient));
    const clientPromise = Promise.all([clientReady, openPromise]).then(
      ([client]): WsSessionHandle => ({ client, runtime }),
    );
    return { runtime, clientScope, clientPromise };
  }

  private async openReconnectLoop(): Promise<WsSessionHandle> {
    while (!this.disposed) {
      await this.waitForReconnectDelay(reconnectDelayMs(this.reconnectFailures));
      if (this.disposed) break;
      await this.refreshTokenBeforeReconnect();

      const session = this.createSession();
      this.runtime = session.runtime;
      this.clientScope = session.clientScope;
      this.clientPromise = session.clientPromise;
      void this.clientPromise.catch(() => undefined);

      try {
        const handle = await session.clientPromise;
        this.reconnectFailures = 0;
        this.callbacks.onReconnected(handle);
        return handle;
      } catch {
        this.reconnectFailures += 1;
        this.sessionVersion += 1;
        this.closeSession(session.runtime, session.clientScope);
      }
    }
    throw new Error("Transport disposed");
  }

  private async refreshTokenBeforeReconnect(): Promise<void> {
    if (this.explicitUrl || window.desktopBridge || !getBrowserWebSocketToken()) return;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS);
    try {
      await refreshBrowserWebSocketToken({ signal: controller.signal });
    } catch (error) {
      console.warn("WebSocket authentication refresh failed", error);
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private waitForReconnectDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        if (this.wakeReconnectDelay === finish) this.wakeReconnectDelay = null;
        resolve();
      };
      const timeout = globalThis.setTimeout(finish, delayMs);
      this.wakeReconnectDelay = finish;
    });
  }

  private closeSession(
    runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>,
    clientScope: Scope.Closeable,
  ): void {
    void runtime
      .runPromise(Scope.close(clientScope, Exit.void))
      .catch(() => undefined)
      .finally(() => void runtime.dispose().catch(() => undefined));
  }

  private readonly handleOnline = () => {
    if (this.disposed) return;
    if (this.reconnectPromise) this.wakeReconnectDelay?.();
    else void this.reconnect().catch(() => undefined);
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
      return;
    }
    const shouldReconnect =
      isStandaloneWebApp() && shouldReconnectAfterBackground(this.hiddenAt, Date.now());
    this.hiddenAt = null;
    if (shouldReconnect || !this.isOpen) this.handleOnline();
  };

  private readonly handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) this.handleOnline();
  };

  private installRecoveryListeners(): void {
    if (typeof window.addEventListener !== "function" || typeof document === "undefined") return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("pageshow", this.handlePageShow);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private removeRecoveryListeners(): void {
    if (typeof window.removeEventListener !== "function" || typeof document === "undefined") return;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("pageshow", this.handlePageShow);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }
}
