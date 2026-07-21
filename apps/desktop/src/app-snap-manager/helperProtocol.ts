// FILE: app-snap-manager/helperProtocol.ts
// Purpose: Parses AppSnap helper messages and normalizes public error/state values.
// Layer: Desktop main-process service

import * as Path from "node:path";

import type {
  DesktopAppSnapErrorEvent,
  DesktopAppSnapPermission,
  DesktopAppSnapPlatform,
} from "@agent-group/contracts";

import type { AppSnapHelperMessage, ResolvedDesktopAppSnapManagerOptions } from "./contracts";

export const MAX_HELPER_STDERR_CHARS = 4_096;

export function normalizeDate(value: unknown, fallback: Date): string {
  if (typeof value !== "string") return fallback.toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback.toISOString();
}

export function normalizeOptionalText(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

export function normalizeAppIconDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256_000) return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

function isPermission(value: unknown): value is "granted" | "denied" {
  return value === "granted" || value === "denied";
}

export function desktopAppSnapPlatform(platform: NodeJS.Platform): DesktopAppSnapPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "other";
}

export function parseAppSnapHelperMessage(line: string): AppSnapHelperMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;

  if (
    value.type === "permissions" &&
    isPermission(value.inputMonitoring) &&
    isPermission(value.screenRecording)
  ) {
    return {
      type: "permissions",
      inputMonitoring: value.inputMonitoring,
      screenRecording: value.screenRecording,
    };
  }
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "triggered" && typeof value.id === "string" && value.id.length > 0) {
    return {
      type: "triggered",
      id: value.id,
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  if (
    value.type === "captured" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.name === "string"
  ) {
    return {
      type: "captured",
      id: value.id,
      path: value.path,
      name: value.name,
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
      ...(typeof value.sourceAppName === "string" || value.sourceAppName === null
        ? { sourceAppName: value.sourceAppName }
        : {}),
      ...(typeof value.sourceBundleIdentifier === "string" || value.sourceBundleIdentifier === null
        ? { sourceBundleIdentifier: value.sourceBundleIdentifier }
        : {}),
      ...(typeof value.sourceAppIconDataUrl === "string" || value.sourceAppIconDataUrl === null
        ? { sourceAppIconDataUrl: value.sourceAppIconDataUrl }
        : {}),
      ...(typeof value.sourceWindowTitle === "string" || value.sourceWindowTitle === null
        ? { sourceWindowTitle: value.sourceWindowTitle }
        : {}),
    };
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    return {
      type: "error",
      code: value.code,
      message: value.message,
      ...(typeof value.id === "string" && value.id.length > 0 ? { id: value.id } : {}),
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  return null;
}

export function isPathInsideDirectory(directory: string, candidate: string): boolean {
  const relative = Path.relative(Path.resolve(directory), Path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith(`..${Path.sep}`) && relative !== "..";
}

export function permissionRequiredMessage(
  inputMonitoring: DesktopAppSnapPermission,
  screenRecording: DesktopAppSnapPermission,
): string {
  const missing: string[] = [];
  if (inputMonitoring !== "granted") missing.push("Input Monitoring");
  if (screenRecording !== "granted") missing.push("Screen Recording");
  return `Allow ${missing.join(" and ")} in macOS System Settings, then try again.`;
}

export function isPermissionErrorCode(code: string): boolean {
  return (
    code === "input-monitoring-required" ||
    code === "screen-recording-required" ||
    code === "permission-required"
  );
}

export function isBenignCaptureErrorCode(code: string): boolean {
  return code === "capture_in_progress" || code === "capture-in-progress";
}

export function emitCaptureError(
  options: ResolvedDesktopAppSnapManagerOptions,
  code: string,
  message: string,
  capturedAt: string | undefined,
  focusApp: boolean,
): void {
  const error: DesktopAppSnapErrorEvent = {
    code: normalizeOptionalText(code, 128) ?? "capture-failed",
    message: normalizeOptionalText(message, 1_000) ?? "AppSnap capture failed.",
    capturedAt: normalizeDate(capturedAt, options.now()),
  };
  options.onError(error, focusApp);
}
