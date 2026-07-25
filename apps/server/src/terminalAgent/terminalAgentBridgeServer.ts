import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import type { TerminalAgentBridgeHandler } from "./terminalAgentBridgeOperation";
import { resolveTerminalAgentBridgeOperation } from "./terminalAgentBridgeOperation";
import {
  TerminalAgentBridgeBudgetExceeded,
  declaredBodyBytes,
  discardRequestBody,
  parseTerminalAgentBridgeRequest,
  readJsonBody,
  releaseRequestBudget,
  reserveBodyThrough,
  reserveRequestBudget,
  resolveTerminalAgentBridgeResourceLimits,
  type ResolvedTerminalAgentBridgeResourceLimits,
  type TerminalAgentBridgeResourceLimits,
} from "./terminalAgentBridgeBudget";
import {
  closeBridgeHttpServer,
  prepareTerminalAgentBridgeEndpoint,
  removeOwnedTerminalAgentBridgeSocket,
  terminalAgentBridgeEndpoint,
  type TerminalAgentBridgeSocketIdentity,
} from "./terminalAgentBridgeSocket";

export { terminalAgentBridgeEndpoint } from "./terminalAgentBridgeSocket";

const MAX_RUNTIMES = 1_000;
const RATE_WINDOW_MS = 10_000;
const RATE_WINDOW_REQUESTS = 240;
const HANDLER_TIMEOUT_MS = 7_000;
const QUIESCE_TIMEOUT_MS = 40_000;

interface RegisteredRuntime {
  readonly runtimeInstanceId: string;
  readonly handler: TerminalAgentBridgeHandler;
  readonly activeControllers: Set<AbortController>;
  handlerTail: Promise<void>;
  closed: boolean;
  paused: boolean;
  requestCount: number;
  windowStartedAt: number;
  pendingRequests: number;
  pendingBodyBytes: number;
}

function bearerToken(request: http.IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function consumeRateLimit(runtime: RegisteredRuntime): boolean {
  const now = Date.now();
  if (now - runtime.windowStartedAt >= RATE_WINDOW_MS) {
    runtime.windowStartedAt = now;
    runtime.requestCount = 0;
  }
  runtime.requestCount += 1;
  return runtime.requestCount <= RATE_WINDOW_REQUESTS;
}

export class TerminalAgentBridgeServer {
  readonly endpoint: string;
  private readonly runtimesByToken = new Map<string, RegisteredRuntime>();
  private server: http.Server | null = null;
  private ownedSocketIdentity: TerminalAgentBridgeSocketIdentity | null = null;
  private readonly resourceLimits: ResolvedTerminalAgentBridgeResourceLimits;

  constructor(
    private readonly stateDir: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly handlerTimeoutMs = HANDLER_TIMEOUT_MS,
    private readonly quiesceTimeoutMs = QUIESCE_TIMEOUT_MS,
    limits: TerminalAgentBridgeResourceLimits = {},
  ) {
    this.endpoint = terminalAgentBridgeEndpoint(stateDir, platform);
    this.resourceLimits = resolveTerminalAgentBridgeResourceLimits(limits);
  }

  async start(): Promise<void> {
    if (this.server) return;
    await fs.mkdir(path.join(this.stateDir, "terminal-agent"), {
      recursive: true,
      mode: 0o700,
    });
    if (this.platform !== "win32") {
      await prepareTerminalAgentBridgeEndpoint(this.endpoint);
    }
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    server.requestTimeout = this.handlerTimeoutMs;
    server.headersTimeout = this.handlerTimeoutMs;
    let identity: TerminalAgentBridgeSocketIdentity | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.endpoint, () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (this.platform !== "win32") {
        const stat = await fs.lstat(this.endpoint);
        if (!stat.isSocket()) {
          throw new Error("Managed terminal bridge endpoint is not a socket.");
        }
        identity = { device: stat.dev, inode: stat.ino };
        await fs.chmod(this.endpoint, 0o600);
      }
      this.server = server;
      this.ownedSocketIdentity = identity;
    } catch (cause) {
      await closeBridgeHttpServer(server, this.endpoint, identity);
      if (identity) {
        await removeOwnedTerminalAgentBridgeSocket(this.endpoint, identity);
      }
      throw cause;
    }
  }

  register(runtimeInstanceId: string, handler: TerminalAgentBridgeHandler) {
    if (this.runtimesByToken.size >= MAX_RUNTIMES) {
      throw new Error("Managed terminal bridge runtime limit reached.");
    }
    const token = randomBytes(32).toString("base64url");
    const runtime: RegisteredRuntime = {
      runtimeInstanceId,
      handler,
      activeControllers: new Set(),
      handlerTail: Promise.resolve(),
      closed: false,
      paused: false,
      requestCount: 0,
      windowStartedAt: Date.now(),
      pendingRequests: 0,
      pendingBodyBytes: 0,
    };
    this.runtimesByToken.set(token, runtime);
    return {
      token,
      pause: async () => {
        if (runtime.closed) return;
        runtime.paused = true;
        for (const controller of runtime.activeControllers) controller.abort();
        runtime.activeControllers.clear();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            runtime.handlerTail,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Managed terminal hook quiesce timed out.")),
                this.quiesceTimeoutMs,
              );
            }),
          ]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      },
      resume: () => {
        if (!runtime.closed) runtime.paused = false;
      },
      unregister: () => {
        runtime.closed = true;
        for (const controller of runtime.activeControllers) controller.abort();
        runtime.activeControllers.clear();
        this.runtimesByToken.delete(token);
      },
    };
  }

  async close(): Promise<void> {
    for (const runtime of this.runtimesByToken.values()) {
      runtime.closed = true;
      for (const controller of runtime.activeControllers) controller.abort();
      runtime.activeControllers.clear();
    }
    this.runtimesByToken.clear();
    const server = this.server;
    const identity = this.ownedSocketIdentity;
    this.server = null;
    this.ownedSocketIdentity = null;
    if (server) await closeBridgeHttpServer(server, this.endpoint, identity);
    if (this.platform !== "win32" && identity) {
      await removeOwnedTerminalAgentBridgeSocket(this.endpoint, identity);
    }
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST" || request.url !== "/hook") {
      request.resume();
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    const token = bearerToken(request);
    const runtime = token ? this.runtimesByToken.get(token) : undefined;
    if (!runtime) {
      request.resume();
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }
    let declaredBytes: number | undefined;
    try {
      declaredBytes = declaredBodyBytes(request);
    } catch {
      const timeout = setTimeout(() => request.destroy(), this.handlerTimeoutMs);
      try {
        await discardRequestBody(request);
      } finally {
        clearTimeout(timeout);
      }
      if (!response.destroyed) {
        sendJson(response, 400, { error: "Invalid hook request." });
      }
      return;
    }
    const budget = reserveRequestBudget(
      runtime,
      declaredBytes ?? 0,
      this.resourceLimits,
    );
    if (!budget) {
      request.resume();
      sendJson(response, 429, { error: "Hook bridge overloaded." });
      return;
    }
    try {
      if (!consumeRateLimit(runtime)) {
        request.resume();
        sendJson(response, 429, { error: "Rate limit exceeded." });
        return;
      }
      const controller = new AbortController();
      runtime.activeControllers.add(controller);
      const abortRequestBody = () => {
        if (!request.complete && !request.destroyed) {
          request.destroy();
        }
      };
      const onResponseClose = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.once("close", onResponseClose);
      const timeout = setTimeout(() => {
        controller.abort();
        abortRequestBody();
      }, this.handlerTimeoutMs);
      try {
        let bridgeRequest: TerminalAgentBridgeRequest;
        try {
          bridgeRequest = parseTerminalAgentBridgeRequest(
            await readJsonBody(request, (bodyBytes) =>
              reserveBodyThrough(runtime, budget, bodyBytes, this.resourceLimits),
            ),
          );
        } catch (cause) {
          if (!response.destroyed) {
            const overloaded = cause instanceof TerminalAgentBridgeBudgetExceeded;
            const interrupted = controller.signal.aborted;
            sendJson(response, interrupted ? 503 : overloaded ? 429 : 400, {
              error: overloaded
                ? "Hook bridge overloaded."
                : interrupted
                  ? "Hook handling failed."
                  : "Invalid hook request.",
            });
          }
          return;
        }
        if (
          runtime.closed ||
          runtime.paused ||
          bridgeRequest.runtimeInstanceId !== runtime.runtimeInstanceId
        ) {
          sendJson(response, 409, { error: "Stale runtime." });
          return;
        }

        let cancelRequested = false;
        let cancelOperation: (() => Promise<void>) | undefined;
        let cancellation: Promise<void> | undefined;
        const cancelCurrent = async () => {
          cancelRequested = true;
          if (cancelOperation && cancellation === undefined) {
            cancellation = Promise.resolve().then(cancelOperation);
          }
          await cancellation;
        };
        const handled = runtime.handlerTail.then(async () => {
          if (runtime.closed || runtime.paused || controller.signal.aborted) {
            throw new Error("Stale or interrupted runtime request.");
          }
          const operation = resolveTerminalAgentBridgeOperation(
            runtime.handler(bridgeRequest, controller.signal),
          );
          cancelOperation = operation.cancel;
          try {
            if (cancelRequested || controller.signal.aborted) {
              await cancelCurrent();
              throw new Error("Stale or interrupted runtime request.");
            }
            const result = await operation.result;
            if (
              runtime.closed ||
              runtime.paused ||
              cancelRequested ||
              controller.signal.aborted
            ) {
              throw new Error("Stale or interrupted runtime request.");
            }
            return result;
          } finally {
            if (cancelRequested) await cancelCurrent();
          }
        });
        runtime.handlerTail = handled.then(
          () => undefined,
          () => undefined,
        );
        let interruptListener: (() => void) | undefined;
        const interrupted = new Promise<never>((_resolve, reject) => {
          const interrupt = () => {
            void cancelCurrent().catch(() => {
              // The serialized handler tail observes cancellation failure.
            });
            reject(new Error("Hook handling was interrupted."));
          };
          interruptListener = interrupt;
          if (controller.signal.aborted) interrupt();
          else controller.signal.addEventListener("abort", interrupt, { once: true });
        });
        const bounded = Promise.race([handled, interrupted]);
        const result = await bounded.finally(() => {
          if (interruptListener) {
            controller.signal.removeEventListener("abort", interruptListener);
          }
        });
        if (!response.destroyed) sendJson(response, 200, result);
      } catch {
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, 503, { error: "Hook handling failed." });
        }
      } finally {
        clearTimeout(timeout);
        response.off("close", onResponseClose);
        runtime.activeControllers.delete(controller);
      }
    } finally {
      releaseRequestBudget(runtime, budget);
    }
  }
}

export type { TerminalAgentBridgeResourceLimits };
export type { TerminalAgentBridgeHandler } from "./terminalAgentBridgeOperation";
