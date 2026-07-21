import { app } from "electron";
import { DesktopBrowserManager } from "../browserManager";
import { BROWSER_IPC_CHANNELS, sendBrowserCopyLink, sendBrowserState } from "../browserIpc";
import { BrowserUsePipeServer } from "../browserUsePipeServer";
import {
  AGENT_GROUP_BROWSER_LABEL,
  BROWSER_PERF_SAMPLE_INTERVAL_MS,
  browserPerfLoggingEnabled,
} from "./constants";
import { desktopState } from "./state";
import { formatErrorMessage } from "./values";
import { writeDesktopLogHeader } from "./logging";

export const browserManager = new DesktopBrowserManager();

browserManager.subscribe((state) => sendBrowserState(desktopState.mainWindow?.webContents, state));
browserManager.subscribeCopyLink((event) =>
  sendBrowserCopyLink(desktopState.mainWindow?.webContents, event),
);

export function startBrowserPerformanceLogging(): void {
  if (desktopState.browserPerfInterval || !browserPerfLoggingEnabled) return;
  desktopState.browserPerfInterval = setInterval(() => {
    const snapshot = browserManager.getPerformanceSnapshot();
    const trackedProcessIds = new Set(snapshot.trackedProcessIds);
    const processMetrics = app
      .getAppMetrics()
      .filter((metric) => trackedProcessIds.has(metric.pid))
      .map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        cpu: Number(metric.cpu.percentCPUUsage.toFixed(1)),
        memMb: Math.round(metric.memory.workingSetSize / 1024),
        name: metric.name,
      }));
    console.info(`[${AGENT_GROUP_BROWSER_LABEL} perf]`, {
      ...snapshot.counters,
      trackedProcessIds: snapshot.trackedProcessIds,
      processes: processMetrics,
    });
  }, BROWSER_PERF_SAMPLE_INTERVAL_MS);
  desktopState.browserPerfInterval.unref();
}

export async function ensureBrowserUsePipeServer(): Promise<void> {
  if (desktopState.browserUsePipeServer) return;
  const server = new BrowserUsePipeServer(browserManager, {
    requestOpenPanel: () => {
      desktopState.mainWindow?.webContents.send(BROWSER_IPC_CHANNELS.requestOpenPanel);
    },
  });
  await server.start();
  desktopState.browserUsePipeServer = server;
}

export async function disposeBrowserUsePipeServer(reason: string): Promise<void> {
  const pipeServer = desktopState.browserUsePipeServer;
  desktopState.browserUsePipeServer = null;
  if (!pipeServer) return;
  try {
    await pipeServer.dispose();
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    writeDesktopLogHeader(`${reason} browser-use pipe dispose failed message=${message}`);
    console.warn(`[desktop] Failed to dispose browser-use pipe during ${reason}: ${message}`);
  }
}
