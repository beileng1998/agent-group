import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "@agent-group/contracts";

import { readNativeApi } from "~/nativeApi";

import type { TerminalRuntimeEntry } from "../terminalRuntimeTypes";

const VISUAL_RESIZE_MIN_INTERVAL_MS = 64;
const BACKEND_RESIZE_DEBOUNCE_MS = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Keep the rendered grid and the backend PTY inside the same contract bounds.
export function fitTerminal(entry: TerminalRuntimeEntry): void {
  entry.fitAddon.fit();
  const cols = clamp(entry.terminal.cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
  const rows = clamp(entry.terminal.rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
  if (cols !== entry.terminal.cols || rows !== entry.terminal.rows) {
    entry.terminal.resize(cols, rows);
  }
}

export function clearBackendResizeTimer(entry: TerminalRuntimeEntry): void {
  if (entry.resizeDispatchTimer !== null) {
    window.clearTimeout(entry.resizeDispatchTimer);
    entry.resizeDispatchTimer = null;
  }
}

function flushPendingResize(entry: TerminalRuntimeEntry): void {
  const api = readNativeApi();
  const pendingResize = entry.pendingResize;
  if (!api || !pendingResize) return;

  entry.pendingResize = null;
  entry.lastSentResize = pendingResize;
  void api.terminal
    .resize({
      threadId: entry.threadId,
      terminalId: entry.terminalId,
      cols: pendingResize.cols,
      rows: pendingResize.rows,
    })
    .catch(() => {
      const current = entry.lastSentResize;
      if (current && current.cols === pendingResize.cols && current.rows === pendingResize.rows) {
        entry.lastSentResize = null;
      }
    });
}

function queueBackendResize(entry: TerminalRuntimeEntry, cols: number, rows: number): void {
  const lastSentResize = entry.lastSentResize;
  const pendingResize = entry.pendingResize;
  if (
    (lastSentResize && lastSentResize.cols === cols && lastSentResize.rows === rows) ||
    (pendingResize && pendingResize.cols === cols && pendingResize.rows === rows)
  ) {
    return;
  }
  entry.pendingResize = { cols, rows };
  clearBackendResizeTimer(entry);
  entry.resizeDispatchTimer = window.setTimeout(() => {
    entry.resizeDispatchTimer = null;
    flushPendingResize(entry);
  }, BACKEND_RESIZE_DEBOUNCE_MS);
}

export function runTerminalResize(
  entry: TerminalRuntimeEntry,
  options?: { clearTextureAtlas?: boolean; refresh?: boolean; dispatchBackend?: boolean },
): void {
  if (!entry.container || !entry.viewState.isVisible) return;

  const { clearTextureAtlas = false, refresh = false, dispatchBackend = true } = options ?? {};
  const buffer = entry.terminal.buffer.active;
  const wasAtBottom = buffer.viewportY >= buffer.baseY;
  const savedViewportY = buffer.viewportY;
  const previousCols = entry.terminal.cols;
  const previousRows = entry.terminal.rows;

  if (clearTextureAtlas) {
    (
      entry.webglAddon as unknown as {
        clearTextureAtlas?: () => void;
      } | null
    )?.clearTextureAtlas?.();
  }

  fitTerminal(entry);
  if (wasAtBottom) {
    entry.terminal.scrollToBottom();
  } else {
    const targetViewportY = Math.min(savedViewportY, entry.terminal.buffer.active.baseY);
    if (entry.terminal.buffer.active.viewportY !== targetViewportY) {
      entry.terminal.scrollToLine(targetViewportY);
    }
  }
  const dimensionsChanged =
    entry.terminal.cols !== previousCols || entry.terminal.rows !== previousRows;
  if (dispatchBackend && dimensionsChanged) {
    queueBackendResize(entry, entry.terminal.cols, entry.terminal.rows);
  }
  if (refresh) {
    entry.terminal.refresh(0, Math.max(0, entry.terminal.rows - 1));
  }
}

export function cancelScheduledVisualResize(entry: TerminalRuntimeEntry): void {
  if (entry.visualResizeFrame !== null) {
    window.cancelAnimationFrame(entry.visualResizeFrame);
    entry.visualResizeFrame = null;
  }
  if (entry.visualResizeTimer !== null) {
    window.clearTimeout(entry.visualResizeTimer);
    entry.visualResizeTimer = null;
  }
}

function scheduleVisualResize(entry: TerminalRuntimeEntry): void {
  if (!entry.viewState.isVisible || entry.visualResizeTimer !== null) {
    return;
  }

  const now = Date.now();
  const remaining = Math.max(0, VISUAL_RESIZE_MIN_INTERVAL_MS - (now - entry.lastVisualResizeAt));

  const run = () => {
    entry.visualResizeTimer = null;
    if (entry.visualResizeFrame !== null) {
      window.cancelAnimationFrame(entry.visualResizeFrame);
    }
    entry.visualResizeFrame = window.requestAnimationFrame(() => {
      entry.visualResizeFrame = null;
      entry.lastVisualResizeAt = Date.now();
      runTerminalResize(entry);
    });
  };

  if (remaining === 0) {
    run();
    return;
  }

  entry.visualResizeTimer = window.setTimeout(run, remaining);
}

export function applyInitialTerminalVisualResize(entry: TerminalRuntimeEntry): void {
  if (!entry.viewState.isVisible) return;

  let firstFrame = 0;
  let secondFrame = 0;

  firstFrame = window.requestAnimationFrame(() => {
    cancelScheduledVisualResize(entry);
    entry.lastVisualResizeAt = Date.now();
    runTerminalResize(entry, {
      clearTextureAtlas: true,
      refresh: true,
    });

    secondFrame = window.requestAnimationFrame(() => {
      entry.lastVisualResizeAt = Date.now();
      runTerminalResize(entry, { refresh: true });
    });
  });

  entry.attachDisposables.push(() => {
    if (firstFrame !== 0) {
      window.cancelAnimationFrame(firstFrame);
    }
    if (secondFrame !== 0) {
      window.cancelAnimationFrame(secondFrame);
    }
  });
}

export function ensureTerminalResizeObserver(entry: TerminalRuntimeEntry): void {
  if (!entry.container || !entry.viewState.isVisible || entry.resizeObserver) {
    return;
  }

  let frame = 0;
  const observer = new ResizeObserver((entries) => {
    if (
      entries.some(
        (resizeEntry) => resizeEntry.contentRect.width <= 0 || resizeEntry.contentRect.height <= 0,
      )
    ) {
      cancelScheduledVisualResize(entry);
      return;
    }
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      scheduleVisualResize(entry);
    });
  });

  observer.observe(entry.container);
  entry.resizeObserver = observer;
  entry.attachDisposables.push(() => {
    observer.disconnect();
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
    }
    if (entry.resizeObserver === observer) {
      entry.resizeObserver = null;
    }
  });
}

export function clearTerminalAttachDisposables(entry: TerminalRuntimeEntry): void {
  const disposables = [...entry.attachDisposables];
  entry.attachDisposables.length = 0;
  for (const dispose of disposables) {
    dispose();
  }
  entry.resizeObserver = null;
}
