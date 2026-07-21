import { describeErrorMessage } from "@agent-group/shared/errorMessages";

import { readNativeApi } from "~/nativeApi";

import { writeSystemMessage } from "../terminalRuntimeAppearance";
import type {
  TerminalRuntimeConfig,
  TerminalRuntimeEntry,
  TerminalRuntimeViewState,
} from "../terminalRuntimeTypes";
import {
  buildTerminalOpenInput,
  setTerminalRuntimeStatus,
  terminalSnapshotHasReplayPayload,
} from "./terminalRuntimeContract";
import { clearPendingTerminalWrites, replayTerminalSnapshot } from "./terminalRuntimeOutput";
import {
  disposeTerminalWebglAddon,
  getTerminalParkingContainer,
  maybeLoadTerminalWebglAddon,
  startTerminalVisibilityRecovery,
  stopTerminalVisibilityRecovery,
} from "./terminalRuntimePresentation";
import {
  applyInitialTerminalVisualResize,
  cancelScheduledVisualResize,
  clearBackendResizeTimer,
  clearTerminalAttachDisposables,
  ensureTerminalResizeObserver,
  fitTerminal,
} from "./terminalRuntimeResize";

const OPEN_SNAPSHOT_RECONCILE_DELAY_MS = 250;

export function syncRuntimeConfig(
  entry: TerminalRuntimeEntry,
  config: TerminalRuntimeConfig,
): void {
  entry.runtimeKey = config.runtimeKey;
  entry.threadId = config.threadId;
  entry.terminalId = config.terminalId;
  entry.terminalLabel = config.terminalLabel;
  entry.terminalCliKind = config.terminalCliKind ?? entry.terminalCliKind ?? null;
  entry.cwd = config.cwd;
  if (config.runtimeEnv === undefined) {
    delete entry.runtimeEnv;
  } else {
    entry.runtimeEnv = config.runtimeEnv;
  }
  entry.callbacks = config.callbacks;
}

function openTerminal(entry: TerminalRuntimeEntry): void {
  const api = readNativeApi();
  if (!api || entry.opened) return;

  fitTerminal(entry);
  entry.lastSentResize = null;
  entry.opened = true;
  setTerminalRuntimeStatus(entry, "connecting");
  const outputEventVersionAtOpen = entry.outputEventVersion;
  const openInput = buildTerminalOpenInput(entry);

  void api.terminal
    .open(openInput)
    .then((snapshot) => {
      if (entry.disposed) return;
      if (
        terminalSnapshotHasReplayPayload(snapshot) &&
        entry.outputEventVersion === outputEventVersionAtOpen
      ) {
        replayTerminalSnapshot(entry, snapshot, () => setTerminalRuntimeStatus(entry, "ready"));
      } else if (entry.outputEventVersion === outputEventVersionAtOpen) {
        setTerminalRuntimeStatus(entry, "ready");
        window.setTimeout(() => {
          if (
            entry.disposed ||
            !entry.opened ||
            entry.outputEventVersion !== outputEventVersionAtOpen
          ) {
            return;
          }
          void api.terminal
            .open(openInput)
            .then((nextSnapshot) => {
              if (
                entry.disposed ||
                entry.outputEventVersion !== outputEventVersionAtOpen ||
                !terminalSnapshotHasReplayPayload(nextSnapshot)
              ) {
                return;
              }
              replayTerminalSnapshot(entry, nextSnapshot, () =>
                setTerminalRuntimeStatus(entry, "ready"),
              );
            })
            .catch(() => {
              // Best-effort recovery only; the original open already succeeded.
            });
        }, OPEN_SNAPSHOT_RECONCILE_DELAY_MS);
      }
      if (entry.viewState.autoFocus) {
        window.requestAnimationFrame(() => {
          entry.terminal.focus();
        });
      }
    })
    .catch((error) => {
      if (entry.disposed) return;
      entry.opened = false;
      setTerminalRuntimeStatus(entry, "error");
      writeSystemMessage(entry.terminal, describeErrorMessage(error, "Failed to open terminal"));
    });
}

export function attachRuntimeToContainer(
  entry: TerminalRuntimeEntry,
  viewState: TerminalRuntimeViewState,
  container: HTMLDivElement,
): void {
  if (entry.container !== container) {
    detachRuntimeFromContainer(entry);
    entry.container = container;
    container.append(entry.wrapper);
  }

  updateRuntimeViewState(entry, viewState);
  maybeLoadTerminalWebglAddon(entry);
  ensureTerminalResizeObserver(entry);
  startTerminalVisibilityRecovery(entry);
  openTerminal(entry);
}

export function updateRuntimeViewState(
  entry: TerminalRuntimeEntry,
  nextViewState: TerminalRuntimeViewState,
): void {
  const wasVisible = entry.viewState.isVisible;
  entry.viewState = nextViewState;

  if (entry.container) {
    if (nextViewState.isVisible && !wasVisible) {
      maybeLoadTerminalWebglAddon(entry);
      applyInitialTerminalVisualResize(entry);
      ensureTerminalResizeObserver(entry);
      startTerminalVisibilityRecovery(entry);
    } else if (!nextViewState.isVisible && wasVisible) {
      cancelScheduledVisualResize(entry);
      stopTerminalVisibilityRecovery(entry);
      disposeTerminalWebglAddon(entry);
      clearTerminalAttachDisposables(entry);
    }
  }

  if (nextViewState.autoFocus) {
    window.requestAnimationFrame(() => {
      entry.terminal.focus();
    });
  }
}

export function detachRuntimeFromContainer(entry: TerminalRuntimeEntry): void {
  cancelScheduledVisualResize(entry);
  stopTerminalVisibilityRecovery(entry);
  disposeTerminalWebglAddon(entry);
  clearTerminalAttachDisposables(entry);
  clearBackendResizeTimer(entry);
  entry.pendingResize = null;
  entry.lastSentResize = null;
  entry.lastVisualResizeAt = 0;
  getTerminalParkingContainer().append(entry.wrapper);
  entry.container = null;
}

export function disposeRuntimeEntry(entry: TerminalRuntimeEntry): void {
  detachRuntimeFromContainer(entry);
  entry.disposed = true;
  // Drop and acknowledge buffered output instead of painting a runtime being destroyed.
  clearPendingTerminalWrites(entry);
  entry.unsubscribeTerminalEvents?.();
  entry.unsubscribeTerminalEvents = null;
  entry.querySuppressionDispose?.();
  entry.querySuppressionDispose = null;
  if (entry.themeRefreshFrame !== 0) {
    window.cancelAnimationFrame(entry.themeRefreshFrame);
    entry.themeRefreshFrame = 0;
  }
  entry.themeObserver?.disconnect();
  entry.themeObserver = null;
  for (const disposable of entry.terminalDisposables) {
    disposable.dispose();
  }
  entry.terminalDisposables.length = 0;
  for (const dispose of entry.persistentDisposables) {
    dispose();
  }
  entry.persistentDisposables.length = 0;
  disposeTerminalWebglAddon(entry);
  entry.terminal.dispose();
  entry.wrapper.remove();
}
