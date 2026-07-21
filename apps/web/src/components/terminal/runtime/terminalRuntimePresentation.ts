import { WebglAddon } from "@xterm/addon-webgl";

import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminalRuntimeAppearance";
import { waitForTerminalFontReady } from "../terminalFontSettle";
import type { TerminalRuntimeEntry } from "../terminalRuntimeTypes";
import {
  type AgentGroupTerminalOptions,
  TERMINAL_CURSOR_STYLE,
  TERMINAL_CURSOR_WIDTH,
  TERMINAL_INACTIVE_CURSOR_STYLE,
} from "./terminalRuntimeContract";
import { cancelScheduledVisualResize, runTerminalResize } from "./terminalRuntimeResize";

const ENABLE_TERMINAL_WEBGL = true;
const TERMINAL_PARKING_CONTAINER_ID = "agent-group-terminal-parking";

// Once WebGL fails, skip it for subsequent terminals in this renderer process.
let suggestedRendererType: "webgl" | "dom" | undefined;

export function getTerminalParkingContainer(): HTMLDivElement {
  let container = document.getElementById(TERMINAL_PARKING_CONTAINER_ID) as HTMLDivElement | null;
  if (container) return container;

  container = document.createElement("div");
  container.id = TERMINAL_PARKING_CONTAINER_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;width:0;height:0;overflow:hidden;contain:strict;left:-10000px;top:-10000px;";
  document.body.append(container);
  return container;
}

export function scheduleTerminalFontSettleRefit(entry: TerminalRuntimeEntry): void {
  const fontFamily = String(entry.terminal.options.fontFamily ?? "").trim();
  if (!fontFamily) return;
  const fontSize = Number(entry.terminal.options.fontSize ?? 12);
  void waitForTerminalFontReady({ fontFamily, fontSize }).then(() => {
    if (entry.disposed) return;
    // Rebuild the glyph atlas after the requested font replaces the fallback font.
    runTerminalResize(entry, { clearTextureAtlas: true, refresh: true });
  });
}

export function startTerminalVisibilityRecovery(entry: TerminalRuntimeEntry): void {
  if (!entry.container || !entry.viewState.isVisible || entry.visibilityCleanup) {
    return;
  }

  let recoveryFrame = 0;
  let throttleTimer: number | null = null;
  let lastRunAt = 0;
  const RECOVERY_THROTTLE_MS = 120;

  const runRecovery = () => {
    const mount = entry.container;
    if (!mount || !mount.isConnected) return;

    const style = window.getComputedStyle(mount);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = mount.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    cancelScheduledVisualResize(entry);
    entry.lastVisualResizeAt = Date.now();
    runTerminalResize(entry, {
      clearTextureAtlas: true,
      refresh: true,
    });
  };

  const scheduleRecovery = () => {
    if (recoveryFrame !== 0) return;

    recoveryFrame = window.requestAnimationFrame(() => {
      recoveryFrame = 0;
      const now = Date.now();
      if (now - lastRunAt < RECOVERY_THROTTLE_MS) {
        const remaining = RECOVERY_THROTTLE_MS - (now - lastRunAt);
        if (throttleTimer !== null) {
          window.clearTimeout(throttleTimer);
        }
        throttleTimer = window.setTimeout(() => {
          throttleTimer = null;
          scheduleRecovery();
        }, remaining + 1);
        return;
      }
      lastRunAt = now;
      runRecovery();
    });
  };

  const handleVisibilityChange = () => {
    if (document.hidden) return;
    scheduleRecovery();
  };
  const handleWindowFocus = () => {
    scheduleRecovery();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleWindowFocus);
  entry.visibilityCleanup = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleWindowFocus);
    if (recoveryFrame !== 0) {
      window.cancelAnimationFrame(recoveryFrame);
    }
    if (throttleTimer !== null) {
      window.clearTimeout(throttleTimer);
    }
    entry.visibilityCleanup = null;
  };
}

export function stopTerminalVisibilityRecovery(entry: TerminalRuntimeEntry): void {
  entry.visibilityCleanup?.();
  entry.visibilityCleanup = null;
}

export function syncTerminalTheme(entry: TerminalRuntimeEntry): void {
  const nextTheme = terminalThemeFromApp();
  const nextFontFamily = getTerminalFontFamily();
  const nextFontSize = getTerminalFontSizePx();
  const nextFontWeight = getTerminalFontWeight();
  const nextBoldFontWeight = getTerminalBoldFontWeight();
  const nextFontKey = JSON.stringify({
    fontFamily: nextFontFamily,
    fontSize: nextFontSize,
    fontWeight: nextFontWeight,
    fontWeightBold: nextBoldFontWeight,
  });
  const nextAppearanceKey = JSON.stringify({
    fontFamily: nextFontFamily,
    fontSize: nextFontSize,
    fontWeight: nextFontWeight,
    fontWeightBold: nextBoldFontWeight,
    cursorStyle: TERMINAL_CURSOR_STYLE,
    cursorInactiveStyle: TERMINAL_INACTIVE_CURSOR_STYLE,
    cursorWidth: TERMINAL_CURSOR_WIDTH,
    theme: nextTheme,
  });
  const previousAppearanceKey = entry.wrapper.dataset.themeKey ?? "";
  if (nextAppearanceKey === previousAppearanceKey) return;

  const shouldClearTextureAtlas = nextFontKey !== (entry.wrapper.dataset.fontKey ?? "");
  entry.wrapper.dataset.themeKey = nextAppearanceKey;
  entry.wrapper.dataset.fontKey = nextFontKey;
  const terminalOptions = entry.terminal.options as AgentGroupTerminalOptions;
  terminalOptions.theme = nextTheme;
  terminalOptions.fontFamily = nextFontFamily;
  terminalOptions.fontSize = nextFontSize;
  terminalOptions.fontWeight = nextFontWeight;
  terminalOptions.fontWeightBold = nextBoldFontWeight;
  terminalOptions.cursorStyle = TERMINAL_CURSOR_STYLE;
  terminalOptions.cursorInactiveStyle = TERMINAL_INACTIVE_CURSOR_STYLE;
  terminalOptions.cursorWidth = TERMINAL_CURSOR_WIDTH;
  if (shouldClearTextureAtlas) {
    scheduleTerminalFontSettleRefit(entry);
  }
  if (entry.viewState.isVisible) {
    runTerminalResize(entry, { clearTextureAtlas: shouldClearTextureAtlas, refresh: true });
  } else {
    entry.terminal.refresh(0, Math.max(0, entry.terminal.rows - 1));
  }
}

function cancelPendingWebglLoad(entry: TerminalRuntimeEntry): void {
  if (entry.webglLoadFrame !== null) {
    window.cancelAnimationFrame(entry.webglLoadFrame);
    entry.webglLoadFrame = null;
  }
}

export function disposeTerminalWebglAddon(entry: TerminalRuntimeEntry): void {
  cancelPendingWebglLoad(entry);
  entry.webglAddon?.dispose();
  entry.webglAddon = null;
}

export function maybeLoadTerminalWebglAddon(entry: TerminalRuntimeEntry): void {
  if (
    entry.disposed ||
    !ENABLE_TERMINAL_WEBGL ||
    suggestedRendererType === "dom" ||
    entry.webglAddon !== null ||
    entry.webglLoadFrame !== null ||
    !entry.viewState.isVisible
  ) {
    return;
  }

  entry.webglLoadFrame = window.requestAnimationFrame(() => {
    entry.webglLoadFrame = null;
    if (
      entry.disposed ||
      !ENABLE_TERMINAL_WEBGL ||
      suggestedRendererType === "dom" ||
      entry.webglAddon !== null ||
      !entry.viewState.isVisible
    ) {
      return;
    }

    try {
      const nextWebglAddon = new WebglAddon();
      nextWebglAddon.onContextLoss(() => {
        suggestedRendererType = "dom";
        nextWebglAddon.dispose();
        if (entry.webglAddon === nextWebglAddon) {
          entry.webglAddon = null;
        }
        entry.terminal.refresh(0, Math.max(0, entry.terminal.rows - 1));
      });
      entry.terminal.loadAddon(nextWebglAddon);
      entry.webglAddon = nextWebglAddon;
    } catch {
      suggestedRendererType = "dom";
      entry.webglAddon = null;
    }
  });
}
