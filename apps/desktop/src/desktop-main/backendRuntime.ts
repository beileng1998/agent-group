import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, BrowserWindow } from "electron";
import * as Effect from "effect/Effect";
import { NetService } from "@agent-group/shared/Net";
import { isBackendReadinessAborted, waitForHttpReady } from "../backendReadiness";
import { resolveBackendNodeArgs } from "../backendNodeOptions";
import { waitForBackendStartupReady } from "../backendStartupReadiness";
import { openInitialBackendWindow } from "../initialBackendWindowOpen";
import { ServerListeningDetector } from "../serverListeningDetector";
import {
  AGENT_GROUP_BROWSER_USE_PIPE_ENV,
  AGENT_GROUP_BROWSER_USE_PIPE_PATH,
} from "../browserUsePipeServer";
import {
  BACKEND_FORCE_KILL_DELAY_MS,
  BACKEND_MAX_OLD_SPACE_ENV_KEYS,
  BACKEND_SHUTDOWN_TIMEOUT_MS,
  BASE_DIR,
  ROOT_DIR,
  isDevelopment,
} from "./constants";
import { backendState, desktopState } from "./state";
import { resolveAppRoot } from "./appIdentity";
import { resolveServedStaticRoot } from "./staticProtocol";
import { formatErrorMessage, safeConsoleError } from "./values";
import { writeBackendSessionBoundary, writeDesktopLogHeader } from "./logging";

let createWindowCallback: (() => BrowserWindow) | null = null;

const TAILNET_GOOS_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};
const TAILNET_GOARCH_BY_ARCH: Partial<Record<NodeJS.Architecture, string>> = {
  arm64: "arm64",
  x64: "amd64",
};

export function setBackendWindowFactory(factory: () => BrowserWindow): void {
  createWindowCallback = factory;
}

export function initializeBackendAuthToken(): void {
  backendState.authToken = Crypto.randomBytes(24).toString("hex");
}

export function setTailnetProxyUrl(url: string | undefined): void {
  backendState.tailnetProxyUrl = url;
}

function cancelBackendReadinessWait(): void {
  backendState.readinessAbortController?.abort();
  backendState.readinessAbortController = null;
}

async function waitForBackendHttpReady(
  baseUrl: string,
  options?: Parameters<typeof waitForHttpReady>[1],
): Promise<void> {
  cancelBackendReadinessWait();
  const controller = new AbortController();
  backendState.readinessAbortController = controller;
  try {
    await waitForHttpReady(baseUrl, { ...options, signal: controller.signal });
  } finally {
    if (backendState.readinessAbortController === controller) {
      backendState.readinessAbortController = null;
    }
  }
}

export async function reserveBackendEndpoint(reason: string): Promise<void> {
  backendState.port = await Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise,
  );
  backendState.httpUrl = `http://127.0.0.1:${backendState.port}`;
  backendState.wsUrl = `ws://127.0.0.1:${backendState.port}/?token=${encodeURIComponent(backendState.authToken)}`;
  process.env.AGENT_GROUP_DESKTOP_WS_URL = backendState.wsUrl;
  writeDesktopLogHeader(`${reason} resolved backend endpoint port=${backendState.port}`);
}

export async function waitForBackendWindowReady(baseUrl: string): Promise<"listening" | "http"> {
  return waitForBackendStartupReady({
    listeningPromise: backendState.listeningDetector?.promise ?? null,
    waitForHttpReady: () =>
      waitForBackendHttpReady(baseUrl, {
        path: "/health",
        timeoutMs: 60_000,
        isReady: async (response) => {
          if (!response.ok) return false;
          try {
            return ((await response.json()) as { startupReady?: unknown }).startupReady === true;
          } catch {
            return false;
          }
        },
      }),
    cancelHttpWait: cancelBackendReadinessWait,
  });
}

export function ensureInitialBackendWindowOpen(baseUrl = backendState.httpUrl): void {
  if (!createWindowCallback) throw new Error("Desktop window factory is not configured.");
  openInitialBackendWindow({
    isDevelopment,
    baseUrl,
    hasExistingWindow: () =>
      (desktopState.mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null) !== null,
    createWindow: () => {
      desktopState.mainWindow = createWindowCallback?.() ?? null;
    },
    getReadinessInFlight: () => backendState.initialWindowOpenInFlight,
    setReadinessInFlight: (promise) => {
      backendState.initialWindowOpenInFlight = promise;
    },
    waitForBackendWindowReady,
    writeLog: writeDesktopLogHeader,
    isReadinessAborted: isBackendReadinessAborted,
    formatErrorMessage,
    warn: (message, error) => console.warn(message, error),
  });
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  const attach = (stream: NodeJS.ReadableStream | null | undefined): void => {
    stream?.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      desktopState.backendLogSink?.write(buffer);
      backendState.listeningDetector?.push(buffer);
    });
  };
  attach(child.stdout);
  attach(child.stderr);
}

function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), "apps/server/dist/index.mjs");
}

function resolveBackendCwd(): string {
  return app.isPackaged ? OS.homedir() : resolveAppRoot();
}

function backendNodeArgs(): string[] {
  const configuredMaxOldSpaceMb =
    BACKEND_MAX_OLD_SPACE_ENV_KEYS.map((key) => process.env[key]).find(
      (value) => value !== undefined && value.trim().length > 0,
    ) ?? null;
  return resolveBackendNodeArgs({
    configuredMaxOldSpaceMb,
    existingNodeOptions: process.env.NODE_OPTIONS,
    totalMemoryBytes: OS.totalmem(),
  });
}

function resolveTailnetSidecarPath(): string | undefined {
  const binaryName =
    process.platform === "win32" ? "agent-group-tailnet.exe" : "agent-group-tailnet";
  if (app.isPackaged) return Path.join(process.resourcesPath, "tailnet", binaryName);
  const goos = TAILNET_GOOS_BY_PLATFORM[process.platform];
  const goarch = TAILNET_GOARCH_BY_ARCH[process.arch];
  if (!goos || !goarch) return undefined;
  const candidate = Path.join(ROOT_DIR, "apps/tailnet/bin", `${goos}-${goarch}`, binaryName);
  return FS.existsSync(candidate) ? candidate : undefined;
}

function backendEnv(): NodeJS.ProcessEnv {
  const servedStaticRoot = resolveServedStaticRoot();
  const tailnetSidecarPath = resolveTailnetSidecarPath();
  return {
    ...process.env,
    ...(servedStaticRoot?.snapshotted ? { AGENT_GROUP_STATIC_DIR: servedStaticRoot.dir } : {}),
    AGENT_GROUP_MODE: "desktop",
    AGENT_GROUP_NO_BROWSER: "1",
    AGENT_GROUP_PORT: String(backendState.port),
    AGENT_GROUP_HOME: BASE_DIR,
    AGENT_GROUP_AUTH_TOKEN: backendState.authToken,
    ...(tailnetSidecarPath ? { AGENT_GROUP_TAILNET_SIDECAR_PATH: tailnetSidecarPath } : {}),
    ...(backendState.tailnetProxyUrl
      ? { AGENT_GROUP_TAILNET_PROXY_URL: backendState.tailnetProxyUrl }
      : {}),
    [AGENT_GROUP_BROWSER_USE_PIPE_ENV]: AGENT_GROUP_BROWSER_USE_PIPE_PATH,
  };
}

function scheduleBackendRestart(reason: string): void {
  if (desktopState.isQuitting || backendState.restartTimer) return;
  const delayMs = Math.min(500 * 2 ** backendState.restartAttempt, 10_000);
  backendState.restartAttempt += 1;
  safeConsoleError(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);
  backendState.restartTimer = setTimeout(() => {
    backendState.restartTimer = null;
    void restartBackendAfterCrash(reason);
  }, delayMs);
}

async function restartBackendAfterCrash(reason: string): Promise<void> {
  if (desktopState.isQuitting || backendState.process) return;
  cancelBackendReadinessWait();
  try {
    await reserveBackendEndpoint("backend restart");
  } catch (error) {
    scheduleBackendRestart(
      `failed to reserve restart port after ${reason}: ${formatErrorMessage(error)}`,
    );
    return;
  }
  startBackend();
  ensureInitialBackendWindowOpen();
}

export function startBackend(): void {
  if (desktopState.isQuitting || backendState.process) return;
  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }
  const captureLogs = app.isPackaged && desktopState.backendLogSink !== null;
  const child = ChildProcess.spawn(process.execPath, [...backendNodeArgs(), backendEntry], {
    cwd: resolveBackendCwd(),
    env: { ...backendEnv(), ELECTRON_RUN_AS_NODE: "1" },
    stdio: captureLogs ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const detector = new ServerListeningDetector();
  backendState.listeningDetector = detector;
  backendState.process = child;
  let sessionClosed = false;
  const closeSession = (details: string): void => {
    if (sessionClosed) return;
    sessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendState.port} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);
  child.once("spawn", () => {
    backendState.restartAttempt = 0;
  });
  child.on("error", (error) => {
    if (backendState.listeningDetector === detector) {
      detector.fail(error);
      backendState.listeningDetector = null;
    }
    if (backendState.process === child) backendState.process = null;
    closeSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    scheduleBackendRestart(error.message);
  });
  child.on("exit", (code, signal) => {
    if (backendState.listeningDetector === detector) {
      detector.fail(
        new Error(
          `backend exited before logging readiness (code=${code ?? "null"} signal=${signal ?? "null"})`,
        ),
      );
      backendState.listeningDetector = null;
    }
    if (backendState.process === child) backendState.process = null;
    closeSession(`pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!desktopState.isQuitting) {
      scheduleBackendRestart(`code=${code ?? "null"} signal=${signal ?? "null"}`);
    }
  });
}

export function stopBackend(): void {
  cancelBackendReadinessWait();
  backendState.listeningDetector = null;
  if (backendState.restartTimer) {
    clearTimeout(backendState.restartTimer);
    backendState.restartTimer = null;
  }
  const child = backendState.process;
  backendState.process = null;
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, BACKEND_FORCE_KILL_DELAY_MS).unref();
  }
}

export async function stopBackendAndWaitForExit(
  timeoutMs = BACKEND_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  cancelBackendReadinessWait();
  backendState.listeningDetector = null;
  if (backendState.restartTimer) {
    clearTimeout(backendState.restartTimer);
    backendState.restartTimer = null;
  }
  const child = backendState.process;
  backendState.process = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      child.off("exit", settle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (exitTimeoutTimer) clearTimeout(exitTimeoutTimer);
      resolve();
    };
    child.once("exit", settle);
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(
      () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
      Math.min(BACKEND_FORCE_KILL_DELAY_MS, Math.max(1, timeoutMs - 500)),
    );
    forceKillTimer.unref();
    exitTimeoutTimer = setTimeout(settle, timeoutMs);
    exitTimeoutTimer.unref();
  });
}

export async function requestDesktopAuthJson(input: unknown): Promise<unknown> {
  if (!input || typeof input !== "object") throw new Error("Invalid desktop auth request.");
  const record = input as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : "";
  const method =
    record.method === "POST"
      ? "POST"
      : record.method === undefined || record.method === "GET"
        ? "GET"
        : null;
  const { DESKTOP_AUTH_PATHS } = await import("./constants");
  if (!DESKTOP_AUTH_PATHS.has(path) || !method) {
    throw new Error("Desktop auth request is not allowed.");
  }
  const url = new URL(path, backendState.httpUrl);
  url.searchParams.set("token", backendState.authToken);
  const response = await fetch(url, {
    method,
    ...(record.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.body) }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Auth request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}
