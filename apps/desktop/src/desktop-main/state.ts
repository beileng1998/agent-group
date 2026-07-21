import type * as ChildProcess from "node:child_process";
import type { BrowserWindow } from "electron";
import type { RotatingFileSink } from "@agent-group/shared/logging";

import type { ServerListeningDetector } from "../serverListeningDetector";
import type { BrowserUsePipeServer } from "../browserUsePipeServer";
import type { DesktopAppSnapManager } from "../appSnapManager";

export const desktopState = {
  mainWindow: null as BrowserWindow | null,
  isQuitting: false,
  desktopShutdownPromise: null as Promise<void> | null,
  desktopShutdownComplete: false,
  desktopProtocolRegistered: false,
  aboutCommitHashCache: undefined as string | null | undefined,
  appUpdateYmlCache: undefined as Record<string, string> | null | undefined,
  desktopLogSink: null as RotatingFileSink | null,
  backendLogSink: null as RotatingFileSink | null,
  restoreStdIoCapture: null as (() => void) | null,
  unreadBackgroundNotificationCount: 0,
  browserPerfInterval: null as ReturnType<typeof setInterval> | null,
  browserUsePipeServer: null as BrowserUsePipeServer | null,
  appSnapManager: null as DesktopAppSnapManager | null,
};

export const backendState = {
  process: null as ChildProcess.ChildProcess | null,
  port: 0,
  authToken: "",
  tailnetProxyUrl: undefined as string | undefined,
  httpUrl: "",
  wsUrl: "",
  readinessAbortController: null as AbortController | null,
  initialWindowOpenInFlight: null as Promise<void> | null,
  listeningDetector: null as ServerListeningDetector | null,
  restartAttempt: 0,
  restartTimer: null as ReturnType<typeof setTimeout> | null,
};
