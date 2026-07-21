// FILE: app-snap-manager/helperLifecycle.ts
// Purpose: Owns the single AppSnap helper process and permission command lifecycle.
// Layer: Desktop main-process process adapter

import * as FS from "node:fs";
import * as Readline from "node:readline";

import type {
  DesktopAppSnapPermission,
  DesktopAppSnapPlatform,
  DesktopAppSnapState,
} from "@agent-group/contracts";

import type {
  AppSnapCapturedMessage,
  AppSnapHelperMessage,
  AppSnapHelperProcess,
  ResolvedDesktopAppSnapManagerOptions,
} from "./contracts";
import {
  desktopAppSnapPlatform,
  emitCaptureError,
  isBenignCaptureErrorCode,
  isPermissionErrorCode,
  MAX_HELPER_STDERR_CHARS,
  parseAppSnapHelperMessage,
  permissionRequiredMessage,
} from "./helperProtocol";

export class AppSnapHelperLifecycle {
  readonly #options: ResolvedDesktopAppSnapManagerOptions;
  readonly #platform: DesktopAppSnapPlatform;
  readonly #onCaptured: (message: AppSnapCapturedMessage) => void;
  #enabled = false;
  #inputMonitoringPermission: DesktopAppSnapPermission = "unknown";
  #screenRecordingPermission: DesktopAppSnapPermission = "unknown";
  #status: DesktopAppSnapState["status"];
  #message: string | null;
  #watchProcess: AppSnapHelperProcess | null = null;
  #watchOutputLines: Readline.Interface | null = null;
  #watchReconcilePromise: Promise<void> | null = null;
  #watchReconcileRequested = false;
  #permissionProcess: AppSnapHelperProcess | null = null;
  #permissionCommandQueue: Promise<void> = Promise.resolve();
  #disposed = false;
  #intentionalWatchStop = false;

  constructor(
    options: ResolvedDesktopAppSnapManagerOptions,
    onCaptured: (message: AppSnapCapturedMessage) => void,
  ) {
    this.#options = options;
    this.#platform = desktopAppSnapPlatform(options.platform);
    this.#onCaptured = onCaptured;
    this.#status = this.#platform === "macos" ? "disabled" : "unsupported";
    this.#message =
      this.#platform === "macos" ? null : "AppSnap is available only in the macOS desktop app.";
  }

  getState(): DesktopAppSnapState {
    return {
      platform: this.#platform,
      supported: this.#platform === "macos",
      enabled: this.#enabled,
      status: this.#status,
      shortcut: this.#platform === "macos" ? "both-option-keys" : null,
      inputMonitoringPermission: this.#inputMonitoringPermission,
      screenRecordingPermission: this.#screenRecordingPermission,
      message: this.#message,
    };
  }

  async refreshState(): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (!(await this.#runPermissionCommand("--check-permissions"))) return this.getState();
    await this.#reconcileWatchProcess();
    return this.getState();
  }

  async setEnabled(enabled: boolean): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    this.#enabled = enabled;
    if (!enabled) {
      this.#stopWatchProcess();
      this.#setState("disabled", null);
      return this.getState();
    }
    if (!(await this.#runPermissionCommand("--check-permissions"))) return this.getState();
    await this.#reconcileWatchProcess();
    return this.getState();
  }

  async requestPermissions(): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (!(await this.#runPermissionCommand("--request-permissions"))) return this.getState();
    await this.#reconcileWatchProcess();
    return this.getState();
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopWatchProcess();
    this.#permissionProcess?.kill("SIGTERM");
    this.#permissionProcess = null;
  }

  #emitState(): void {
    this.#options.onState(this.getState());
  }

  #setState(status: DesktopAppSnapState["status"], message: string | null): void {
    const changed = this.#status !== status || this.#message !== message;
    this.#status = status;
    this.#message = message;
    if (changed) this.#emitState();
  }

  async #reconcileWatchProcess(): Promise<void> {
    this.#watchReconcileRequested = true;
    if (this.#watchReconcilePromise) {
      await this.#watchReconcilePromise;
      if (this.#watchReconcileRequested) {
        await this.#reconcileWatchProcess();
      }
      return;
    }
    const reconcilePromise = (async () => {
      while (this.#watchReconcileRequested) {
        this.#watchReconcileRequested = false;
        await this.#reconcileWatchProcessOnce();
      }
    })();
    let trackedPromise: Promise<void>;
    trackedPromise = reconcilePromise.finally(() => {
      if (this.#watchReconcilePromise === trackedPromise) {
        this.#watchReconcilePromise = null;
      }
    });
    this.#watchReconcilePromise = trackedPromise;
    await trackedPromise;
    if (this.#watchReconcileRequested) {
      await this.#reconcileWatchProcess();
    }
  }

  async #reconcileWatchProcessOnce(): Promise<void> {
    if (this.#disposed || this.#platform !== "macos") return;
    if (!this.#enabled) {
      this.#stopWatchProcess();
      this.#setState("disabled", null);
      return;
    }
    if (
      this.#inputMonitoringPermission !== "granted" ||
      this.#screenRecordingPermission !== "granted"
    ) {
      this.#stopWatchProcess();
      this.#setState(
        "permission-required",
        permissionRequiredMessage(this.#inputMonitoringPermission, this.#screenRecordingPermission),
      );
      return;
    }
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#stopWatchProcess();
      this.#setState("error", "The AppSnap native helper is missing from this desktop build.");
      return;
    }
    if (this.#watchProcess) return;
    try {
      await FS.promises.mkdir(this.#options.captureDirectory, { recursive: true, mode: 0o700 });
      await FS.promises.chmod(this.#options.captureDirectory, 0o700).catch(() => undefined);
      if (
        this.#disposed ||
        !this.#enabled ||
        this.#watchProcess ||
        this.#inputMonitoringPermission !== "granted" ||
        this.#screenRecordingPermission !== "granted"
      ) {
        return;
      }
      this.#startWatchProcess();
    } catch (error) {
      this.#setState(
        "error",
        `Could not start AppSnap: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #startWatchProcess(): void {
    this.#intentionalWatchStop = false;
    this.#setState("starting", null);
    const child = this.#options.spawn(
      this.#options.helperPath,
      [
        "--watch",
        "--output-dir",
        this.#options.captureDirectory,
        "--excluded-bundle-id",
        this.#options.excludedBundleId,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.#watchProcess = child;
    this.#watchOutputLines = this.#wireHelperOutput(child, (message) =>
      this.#handleWatchMessage(child, message),
    );
    child.once("error", (error) => {
      if (this.#watchProcess !== child) return;
      this.#watchProcess = null;
      this.#watchOutputLines?.close();
      this.#watchOutputLines = null;
      const message = `Could not start AppSnap: ${error.message}`;
      this.#setState("error", message);
      emitCaptureError(this.#options, "helper-stopped", message, undefined, false);
    });
    child.once("exit", (code, signal) => {
      if (this.#watchProcess !== child) return;
      this.#watchProcess = null;
      this.#watchOutputLines?.close();
      this.#watchOutputLines = null;
      if (this.#disposed || this.#intentionalWatchStop || !this.#enabled) return;
      const message = `The AppSnap helper stopped unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}).`;
      this.#setState("error", message);
      emitCaptureError(this.#options, "helper-stopped", message, undefined, false);
    });
  }

  #stopWatchProcess(): void {
    const child = this.#watchProcess;
    this.#watchProcess = null;
    this.#watchOutputLines?.close();
    this.#watchOutputLines = null;
    if (!child) return;
    this.#intentionalWatchStop = true;
    child.kill("SIGTERM");
  }

  #wireHelperOutput(
    child: AppSnapHelperProcess,
    onMessage: (message: AppSnapHelperMessage) => void,
  ): Readline.Interface {
    const lines = Readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = parseAppSnapHelperMessage(line);
      if (message) onMessage(message);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length >= MAX_HELPER_STDERR_CHARS) return;
      stderr = `${stderr}${chunk}`.slice(0, MAX_HELPER_STDERR_CHARS);
    });
    child.once("close", (code) => {
      const diagnostic = stderr.trim();
      if (code !== 0 && diagnostic.length > 0) {
        console.warn(`[desktop-appsnap] Native helper: ${diagnostic}`);
      }
    });
    return lines;
  }

  async #runPermissionCommand(
    command: "--check-permissions" | "--request-permissions",
  ): Promise<boolean> {
    const run = this.#permissionCommandQueue.then(() => this.#executePermissionCommand(command));
    this.#permissionCommandQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  async #executePermissionCommand(
    command: "--check-permissions" | "--request-permissions",
  ): Promise<boolean> {
    if (this.#disposed || this.#platform !== "macos") return false;
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#setState("error", "The AppSnap native helper is missing from this desktop build.");
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      let child: AppSnapHelperProcess;
      try {
        child = this.#options.spawn(this.#options.helperPath, [command], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        this.#setState(
          "error",
          `Could not inspect AppSnap permissions: ${error instanceof Error ? error.message : String(error)}`,
        );
        resolve(false);
        return;
      }
      this.#permissionProcess = child;
      let receivedPermissions = false;
      let reportedError: string | null = null;
      let spawnFailed = false;
      this.#wireHelperOutput(child, (message) => {
        if (message.type === "permissions") {
          receivedPermissions = true;
          this.#inputMonitoringPermission = message.inputMonitoring;
          this.#screenRecordingPermission = message.screenRecording;
          this.#emitState();
        } else if (message.type === "error") {
          reportedError = message.message;
        }
      });
      child.once("error", (error) => {
        spawnFailed = true;
        if (this.#permissionProcess === child) this.#permissionProcess = null;
        this.#setState("error", `Could not inspect AppSnap permissions: ${error.message}`);
        resolve(false);
      });
      child.once("close", () => {
        if (this.#permissionProcess === child) this.#permissionProcess = null;
        if (this.#disposed) {
          resolve(false);
          return;
        }
        if (!receivedPermissions && !spawnFailed) {
          this.#setState(
            "error",
            reportedError ?? "The AppSnap helper did not report its permission state.",
          );
        }
        resolve(receivedPermissions);
      });
    });
  }

  #handleWatchMessage(child: AppSnapHelperProcess, message: AppSnapHelperMessage): void {
    if (this.#disposed || this.#watchProcess !== child) return;
    if (message.type === "ready") {
      this.#inputMonitoringPermission = "granted";
      this.#setState("ready", null);
      return;
    }
    if (message.type === "permissions") {
      this.#inputMonitoringPermission = message.inputMonitoring;
      this.#screenRecordingPermission = message.screenRecording;
      this.#emitState();
      return;
    }
    if (message.type === "triggered") {
      console.info(`[desktop-appsnap] Option chord triggered (${message.id}).`);
      return;
    }
    if (message.type === "captured") {
      this.#onCaptured(message);
      return;
    }

    if (message.code === "event_tap_disabled" || message.code === "event-tap-disabled") {
      console.warn(`[desktop-appsnap] ${message.message}`);
      return;
    }

    console.warn(`[desktop-appsnap] Helper error ${message.code}: ${message.message}`);
    if (message.code === "input-monitoring-required") {
      this.#inputMonitoringPermission = "denied";
    }
    if (message.code === "screen-recording-required") {
      this.#screenRecordingPermission = "denied";
    }
    if (isPermissionErrorCode(message.code)) {
      this.#stopWatchProcess();
      this.#setState(
        "permission-required",
        permissionRequiredMessage(this.#inputMonitoringPermission, this.#screenRecordingPermission),
      );
    }
    emitCaptureError(
      this.#options,
      message.code,
      message.message,
      message.capturedAt,
      !isBenignCaptureErrorCode(message.code),
    );
  }
}
