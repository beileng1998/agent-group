// FILE: main.ts
// Purpose: Composes the Electron desktop runtime without owning domain state.
// Layer: Desktop main process

import { app } from "electron";
import { resolveDesktopRuntimeInfo } from "./runtimeArch";
import { syncShellEnvironment } from "./syncShellEnvironment";
import {
  configureAppIdentity,
  repairBrowserProfileBeforeElectronReady,
  resolveUserDataPath,
} from "./desktop-main/appIdentity";
import { captureStartupBundleIdentity } from "./desktop-main/bundleValues";
import {
  registerDesktopSchemePrivilege,
  setStartupBundleIdentity,
} from "./desktop-main/staticProtocol";
import { initializePackagedLogging } from "./desktop-main/logging";
import { DesktopUpdateRuntime } from "./desktop-main/updateRuntime";
import { DesktopWindowRuntime } from "./desktop-main/windowRuntime";
import { DesktopMenuRuntime } from "./desktop-main/menuRuntime";
import { createBundleSwapRuntime } from "./desktop-main/bundleSwap";
import { DesktopAppLifecycle } from "./desktop-main/appLifecycle";
import {
  setBackendWindowFactory,
  startBackend,
  stopBackendAndWaitForExit,
} from "./desktop-main/backendRuntime";
import { focusMainWindow } from "./desktop-main/notifications";

const startupBundleIdentity = captureStartupBundleIdentity();

syncShellEnvironment();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

initializePackagedLogging();
setStartupBundleIdentity(startupBundleIdentity);
registerDesktopSchemePrivilege();

const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const updates = new DesktopUpdateRuntime(
  { startBackend, stopBackendAndWaitForExit },
  desktopRuntimeInfo,
);
const windows = new DesktopWindowRuntime(updates);
setBackendWindowFactory(windows.createWindow);
const menu = new DesktopMenuRuntime(windows, updates);

let lifecycle: DesktopAppLifecycle;
const bundleSwap = createBundleSwapRuntime({
  startupBundleIdentity,
  requestGracefulAppQuit: (reason) => lifecycle.requestGracefulAppQuit(reason),
  isUpdaterBusy: () => updates.isInstalling,
});
lifecycle = new DesktopAppLifecycle(hasSingleInstanceLock, windows, updates, menu, bundleSwap);

const userDataPath = resolveUserDataPath();
if (hasSingleInstanceLock) {
  repairBrowserProfileBeforeElectronReady(userDataPath);
}
app.setPath("userData", userDataPath);

configureAppIdentity();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => focusMainWindow());
}

lifecycle.register();
