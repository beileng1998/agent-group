import { spawn, type ChildProcess } from "node:child_process";
import FS from "node:fs/promises";
import Path from "node:path";
import readline from "node:readline";

import type { RemoteAccessState, RemoteAccessStatus } from "@agent-group/contracts";
import { Effect, Layer, Stream } from "effect";

import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings";
import { RemoteAccess, RemoteAccessError, type RemoteAccessShape } from "../Services/RemoteAccess";

const PROCESS_NAME =
  process.platform === "win32" ? "agent-group-tailnet.exe" : "agent-group-tailnet";
const MAX_MESSAGE_LENGTH = 1_000;
const VALID_SIDECAR_STATES = new Set<RemoteAccessState>([
  "starting",
  "needs-login",
  "needs-approval",
  "ready",
  "error",
]);

type SidecarEvent = {
  readonly type: "status" | "error";
  readonly state: RemoteAccessState;
  readonly url?: string;
  readonly authUrl?: string;
  readonly transport?: "https" | "http";
  readonly ipv4?: string;
  readonly dnsName?: string;
  readonly health?: ReadonlyArray<string>;
  readonly message?: string;
};

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_MESSAGE_LENGTH) : undefined;
}

function cleanUrl(value: unknown, protocols: ReadonlyArray<string>): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function parseSidecarEvent(line: string): SidecarEvent | null {
  if (line.length > 16_384) return null;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (
      (raw.type !== "status" && raw.type !== "error") ||
      !VALID_SIDECAR_STATES.has(raw.state as RemoteAccessState)
    ) {
      return null;
    }
    const state = raw.state as RemoteAccessState;
    const health = Array.isArray(raw.health)
      ? raw.health
          .flatMap((item) => {
            const message = cleanMessage(item);
            return message ? [message] : [];
          })
          .slice(0, 20)
      : undefined;
    const url = cleanUrl(raw.url, ["https:", "http:"]);
    const authUrl = cleanUrl(raw.authUrl, ["https:"]);
    const ipv4 = cleanMessage(raw.ipv4);
    const dnsName = cleanMessage(raw.dnsName);
    const message = cleanMessage(raw.message);
    const transport =
      raw.transport === "https" || raw.transport === "http" ? raw.transport : undefined;
    return {
      type: raw.type,
      state,
      ...(url ? { url } : {}),
      ...(authUrl ? { authUrl } : {}),
      ...(transport ? { transport } : {}),
      ...(ipv4 ? { ipv4 } : {}),
      ...(dnsName ? { dnsName } : {}),
      ...(health ? { health } : {}),
      ...(message ? { message } : {}),
    };
  } catch {
    return null;
  }
}

function statusFor(
  input: Partial<RemoteAccessStatus> & Pick<RemoteAccessStatus, "enabled" | "state" | "hostname">,
): RemoteAccessStatus {
  return {
    enabled: input.enabled,
    state: input.state,
    hostname: input.hostname,
    processName: PROCESS_NAME,
    health: input.health ?? [],
    ...(input.url ? { url: input.url } : {}),
    ...(input.authUrl ? { authUrl: input.authUrl } : {}),
    ...(input.transport ? { transport: input.transport } : {}),
    ...(input.ipv4 ? { ipv4: input.ipv4 } : {}),
    ...(input.dnsName ? { dnsName: input.dnsName } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
}

class SidecarManager {
  private child: ChildProcess | null = null;
  private desiredEnabled = false;
  private hostname = "agent-group";
  private status = statusFor({ enabled: false, state: "disabled", hostname: this.hostname });
  private operation: Promise<void> = Promise.resolve();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartFailures = 0;
  private intentionalStop = false;

  constructor(
    private readonly binaryPath: string | undefined,
    private readonly unavailableMessage: string,
    private readonly stateDir: string,
    private readonly backendUrl: string,
    private readonly proxyUrl: string | undefined,
  ) {}

  getStatus(): RemoteAccessStatus {
    return { ...this.status, health: [...this.status.health] };
  }

  setDesired(enabled: boolean, hostname: string): Promise<void> {
    return this.enqueue(async () => {
      const hostnameChanged = hostname !== this.hostname;
      this.hostname = hostname || "agent-group";
      this.desiredEnabled = enabled;
      if (!enabled) {
        await this.stopChild();
        this.status = statusFor({ enabled: false, state: "disabled", hostname: this.hostname });
        return;
      }
      if (hostnameChanged && this.child) await this.stopChild();
      if (!this.child) await this.startChild();
    });
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopChild();
      if (this.desiredEnabled) await this.startChild();
    });
  }

  reset(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopChild();
      await FS.rm(this.stateDir, { recursive: true, force: true });
      if (this.desiredEnabled) await this.startChild();
    });
  }

  close(): Promise<void> {
    this.desiredEnabled = false;
    return this.enqueue(() => this.stopChild());
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => undefined);
    return next;
  }

  private async startChild(): Promise<void> {
    if (!this.binaryPath) {
      this.status = statusFor({
        enabled: true,
        state: "unavailable",
        hostname: this.hostname,
        message: this.unavailableMessage,
      });
      return;
    }
    try {
      await FS.access(this.binaryPath);
      await FS.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      await FS.chmod(this.stateDir, 0o700);
    } catch (cause) {
      this.status = statusFor({
        enabled: true,
        state: "unavailable",
        hostname: this.hostname,
        message: cause instanceof Error ? cause.message : "Tailnet sidecar is unavailable.",
      });
      return;
    }

    this.intentionalStop = false;
    this.status = statusFor({ enabled: true, state: "starting", hostname: this.hostname });
    const env = { ...process.env };
    delete env.TS_AUTHKEY;
    delete env.TS_AUTH_KEY;
    if (this.proxyUrl) {
      env.HTTP_PROXY = this.proxyUrl;
      env.HTTPS_PROXY = this.proxyUrl;
      env.http_proxy = this.proxyUrl;
      env.https_proxy = this.proxyUrl;
      env.NO_PROXY = "127.0.0.1,localhost,::1";
      env.no_proxy = env.NO_PROXY;
    }
    const child = spawn(
      this.binaryPath,
      ["--state-dir", this.stateDir, "--hostname", this.hostname, "--backend-url", this.backendUrl],
      { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    this.child = child;

    if (!child.stdout || !child.stderr) {
      child.kill("SIGTERM");
      throw new Error("Tailnet sidecar streams are unavailable.");
    }
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const event = parseSidecarEvent(line);
      if (!event || this.child !== child) return;
      if (event.state === "ready") this.restartFailures = 0;
      const authUrl =
        event.state === "needs-login"
          ? (event.authUrl ??
            (this.status.state === "needs-login" ? this.status.authUrl : undefined))
          : undefined;
      this.status = statusFor({
        enabled: true,
        state: event.state,
        hostname: this.hostname,
        ...(event.url ? { url: event.url } : {}),
        ...(authUrl ? { authUrl } : {}),
        ...(event.transport ? { transport: event.transport } : {}),
        ...(event.ipv4 ? { ipv4: event.ipv4 } : {}),
        ...(event.dnsName ? { dnsName: event.dnsName } : {}),
        ...(event.health ? { health: [...event.health] } : {}),
        ...(event.message ? { message: event.message } : {}),
      });
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-MAX_MESSAGE_LENGTH);
    });
    child.once("error", (cause) => {
      if (this.child !== child) return;
      this.status = statusFor({
        enabled: true,
        state: "error",
        hostname: this.hostname,
        message: cause.message,
      });
    });
    child.once("exit", (code, signal) => {
      lines.close();
      if (this.child !== child) return;
      this.child = null;
      if (this.intentionalStop || !this.desiredEnabled) return;
      const detail =
        cleanMessage(stderr) ?? `Tailnet sidecar exited (${code ?? signal ?? "unknown"}).`;
      this.status = statusFor({
        enabled: true,
        state: "error",
        hostname: this.hostname,
        message: detail,
      });
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.restartTimer || !this.desiredEnabled) return;
    const delayMs = Math.min(1_000 * 2 ** this.restartFailures, 30_000);
    this.restartFailures += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.enqueue(() =>
        this.desiredEnabled && !this.child ? this.startChild() : Promise.resolve(),
      );
    }, delayMs);
    this.restartTimer.unref();
  }

  private async stopChild(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) return;
    this.intentionalStop = true;
    this.child = null;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

export const makeRemoteAccess = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const manager = new SidecarManager(
    config.authToken ? config.tailnetSidecarPath : undefined,
    config.authToken
      ? "This build does not include the Agent Group Tailnet sidecar."
      : "Application authentication is required before mobile access can start.",
    Path.join(config.stateDir, "tailnet"),
    `http://127.0.0.1:${config.port}`,
    cleanUrl(config.tailnetProxyUrl, ["http:", "https:", "socks5:"]),
  );

  const syncSettings = (next: {
    readonly remoteAccess: { readonly enabled: boolean; readonly hostname: string };
  }) =>
    Effect.tryPromise({
      try: () => manager.setDesired(next.remoteAccess.enabled, next.remoteAccess.hostname),
      catch: (cause) =>
        new RemoteAccessError({ message: "Failed to update remote access.", cause }),
    });

  const start = Effect.gen(function* () {
    yield* settings.ready;
    yield* syncSettings(yield* settings.getSettings);
    yield* Effect.forkScoped(Stream.runForEach(settings.streamChanges, syncSettings));
    yield* Effect.addFinalizer(() => Effect.promise(() => manager.close()));
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof RemoteAccessError
        ? cause
        : new RemoteAccessError({ message: "Failed to start remote access.", cause }),
    ),
  );

  const runOperation = (operation: () => Promise<void>, message: string) =>
    Effect.tryPromise({
      try: async () => {
        await operation();
        return manager.getStatus();
      },
      catch: (cause) => new RemoteAccessError({ message, cause }),
    });

  return {
    start,
    getStatus: Effect.sync(() => manager.getStatus()),
    restart: runOperation(() => manager.restart(), "Failed to restart remote access."),
    reset: runOperation(() => manager.reset(), "Failed to reset remote access."),
  } satisfies RemoteAccessShape;
});

export const RemoteAccessLive = Layer.effect(RemoteAccess, makeRemoteAccess);
