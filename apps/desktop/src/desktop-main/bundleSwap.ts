import * as Path from "node:path";
import { app, dialog } from "electron";
import { isBundleSwapped, isWatchableBundlePath } from "../bundleSwapDetection";
import { BUNDLE_SWAP_POLL_INTERVAL_MS } from "./constants";
import { desktopState } from "./state";
import {
  BundleChangedDuringStartupError,
  readBundleSignature,
  type BundleIdentity,
} from "./bundleValues";
import { writeDesktopLogHeader } from "./logging";

export interface BundleSwapRuntime {
  restartAfterStartupBundleSwap(error: BundleChangedDuringStartupError): void;
  startWatcher(): void;
}

export function createBundleSwapRuntime(input: {
  startupBundleIdentity: BundleIdentity | null;
  requestGracefulAppQuit: (reason: string) => void;
  isUpdaterBusy: () => boolean;
}): BundleSwapRuntime {
  let pollTimer: NodeJS.Timeout | null = null;
  let promptOpen = false;

  const restartAfterStartupBundleSwap = (error: BundleChangedDuringStartupError): void => {
    const baselineSize = error.baseline?.size ?? "unreadable";
    const currentSize = error.current?.size ?? "unreadable";
    writeDesktopLogHeader(
      `bundle changed during startup path=${error.bundlePath} size=${baselineSize}->${currentSize}`,
    );
    console.warn("[desktop] Packaged application changed during startup; restarting", error);
    void dialog
      .showMessageBox({
        type: "warning",
        title: "Agent Group needs to restart",
        message: "Agent Group changed while it was opening.",
        detail:
          "The current process cannot safely read the replaced application bundle. Restart Agent Group to finish opening with one consistent version.",
        buttons: ["Restart Agent Group"],
        defaultId: 0,
      })
      .catch(() => undefined)
      .then(() => {
        app.relaunch();
        input.requestGracefulAppQuit("startup-bundle-swap");
      });
  };

  const startWatcher = (): void => {
    if (!app.isPackaged || pollTimer) return;
    const bundlePath = app.getAppPath();
    if (!isWatchableBundlePath(bundlePath)) return;
    let baseline =
      input.startupBundleIdentity &&
      Path.resolve(input.startupBundleIdentity.path) === Path.resolve(bundlePath)
        ? (input.startupBundleIdentity.signature ?? readBundleSignature(bundlePath))
        : readBundleSignature(bundlePath);
    if (!baseline) return;

    pollTimer = setInterval(() => {
      if (desktopState.isQuitting || input.isUpdaterBusy() || promptOpen) return;
      const current = readBundleSignature(bundlePath);
      if (!baseline || !isBundleSwapped(baseline, current)) return;
      writeDesktopLogHeader(
        `bundle swap detected path=${bundlePath} size=${baseline.size}->${current?.size ?? "unknown"}`,
      );
      baseline = current;
      promptOpen = true;
      void dialog
        .showMessageBox({
          type: "warning",
          title: "Agent Group was replaced on disk",
          message: "The installed Agent Group app changed while it was running.",
          detail:
            "The interface keeps running from a safeguarded copy, but parts of the app loaded later can still read the replaced file. Restart now to pick up the new version safely.",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          promptOpen = false;
          if (response === 0) {
            app.relaunch();
            input.requestGracefulAppQuit("bundle-swap-restart");
          }
        })
        .catch(() => {
          promptOpen = false;
        });
    }, BUNDLE_SWAP_POLL_INTERVAL_MS);
    pollTimer.unref();
  };

  return { restartAfterStartupBundleSwap, startWatcher };
}
