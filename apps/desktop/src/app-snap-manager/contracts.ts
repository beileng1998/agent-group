// FILE: app-snap-manager/contracts.ts
// Purpose: Defines the AppSnap manager's narrow process and protocol contracts.
// Layer: Desktop main-process service

import type * as ChildProcess from "node:child_process";
import type { Readable } from "node:stream";

import type {
  DesktopAppSnapCapture,
  DesktopAppSnapErrorEvent,
  DesktopAppSnapState,
} from "@agent-group/contracts";

export type AppSnapHelperProcess = ChildProcess.ChildProcessByStdio<null, Readable, Readable>;

export type AppSnapHelperMessage =
  | {
      type: "permissions";
      inputMonitoring: "granted" | "denied";
      screenRecording: "granted" | "denied";
    }
  | { type: "ready" }
  | { type: "triggered"; id: string; capturedAt?: string }
  | {
      type: "captured";
      id: string;
      capturedAt?: string;
      path: string;
      name: string;
      sourceAppName?: string | null;
      sourceBundleIdentifier?: string | null;
      sourceAppIconDataUrl?: string | null;
      sourceWindowTitle?: string | null;
    }
  | {
      type: "error";
      id?: string;
      code: string;
      message: string;
      capturedAt?: string;
    };

export type AppSnapCapturedMessage = Extract<AppSnapHelperMessage, { type: "captured" }>;

export interface DesktopAppSnapManagerOptions {
  platform: NodeJS.Platform;
  helperPath: string;
  captureDirectory: string;
  excludedBundleId: string;
  onState: (state: DesktopAppSnapState) => void;
  onCaptured: (capture: DesktopAppSnapCapture) => void;
  onError: (error: DesktopAppSnapErrorEvent, focusApp: boolean) => void;
  now?: () => Date;
  spawn?: typeof ChildProcess.spawn;
}

export type ResolvedDesktopAppSnapManagerOptions = Required<
  Pick<DesktopAppSnapManagerOptions, "now" | "spawn">
> &
  Omit<DesktopAppSnapManagerOptions, "now" | "spawn">;
