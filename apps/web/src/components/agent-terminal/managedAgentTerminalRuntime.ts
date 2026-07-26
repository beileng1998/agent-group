import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "@agent-group/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";

import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminal/terminalRuntimeAppearance";
import type { AgentGroupTerminalOptions } from "../terminal/runtime/terminalRuntimeContract";
import { getTerminalParkingContainer } from "../terminal/runtime/terminalRuntimePresentation";
import { observeManagedAgentTerminalAppearance } from "./managedAgentTerminalAppearance";
import {
  ManagedAgentTerminalTransport,
  type ManagedTerminalConnectionStatus,
} from "./managedAgentTerminalTransport";

const BACKEND_RESIZE_DEBOUNCE_MS = 100;

export type { ManagedTerminalConnectionStatus };

export interface ManagedAgentTerminalRuntimeCallbacks {
  readonly setViewportSize: (cols: number, rows: number) => void;
  readonly onConnectionStatusChange: (
    status: ManagedTerminalConnectionStatus,
  ) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class ManagedAgentTerminalRuntime {
  readonly wrapper = document.createElement("div");
  private readonly terminal: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly transport: ManagedAgentTerminalTransport;
  private container: HTMLDivElement | null = null;
  private callbacks: ManagedAgentTerminalRuntimeCallbacks | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private appearanceObserver: MutationObserver | null = null;
  private resizeFrame = 0;
  private resizeTimer: number | null = null;
  private disposed = false;
  lastUsedAt = Date.now();

  constructor(readonly threadId: string) {
    this.wrapper.className = "h-full w-full";
    const options: AgentGroupTerminalOptions = {
      allowProposedApi: true,
      allowTransparency: false,
      cursorBlink: true,
      customGlyphs: true,
      fontFamily: getTerminalFontFamily(),
      fontSize: getTerminalFontSizePx(),
      fontWeight: getTerminalFontWeight(),
      fontWeightBold: getTerminalBoldFontWeight(),
      scrollback: 5_000,
      theme: terminalThemeFromApp(),
      vtExtensions: { kittyKeyboard: true },
      scrollbar: { showScrollbar: false },
    };
    this.terminal = new Terminal(options);
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";
    this.terminal.open(this.wrapper);
    this.transport = new ManagedAgentTerminalTransport(
      threadId,
      this.terminal,
      (status) => this.callbacks?.onConnectionStatusChange(status),
      () => {
        this.scheduleFit();
        if (this.container) this.terminal.focus();
      },
    );
    this.appearanceObserver = observeManagedAgentTerminalAppearance(
      this.terminal,
      this.scheduleFit,
      () => this.disposed,
    );
  }

  attach(
    container: HTMLDivElement,
    callbacks: ManagedAgentTerminalRuntimeCallbacks,
  ) {
    this.lastUsedAt = Date.now();
    if (this.container !== container) {
      this.detach();
      this.container = container;
      container.append(this.wrapper);
    }
    this.callbacks = callbacks;
    callbacks.onConnectionStatusChange(this.transport.status);
    this.resizeObserver = new ResizeObserver(this.scheduleFit);
    this.resizeObserver.observe(container);
    this.scheduleFit();
    if (this.transport.status === "ready") {
      window.requestAnimationFrame(() => this.terminal.focus());
    }
    return {
      status: this.transport.status,
      retry: this.transport.retry,
    };
  }

  detach(container?: HTMLDivElement): void {
    if (container && this.container !== container) return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.callbacks = null;
    if (this.resizeFrame !== 0) {
      window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = 0;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.container) {
      this.terminal.blur();
      getTerminalParkingContainer().append(this.wrapper);
      this.container = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.transport.dispose();
    this.appearanceObserver?.disconnect();
    this.appearanceObserver = null;
    this.terminal.dispose();
    this.wrapper.remove();
  }

  isParked(): boolean {
    return this.container === null;
  }

  private readonly scheduleFit = () => {
    if (this.disposed || !this.container) return;
    if (this.resizeFrame !== 0) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.runFit();
    });
  };

  private runFit(): void {
    const container = this.container;
    if (
      this.disposed ||
      !container ||
      container.clientWidth <= 1 ||
      container.clientHeight <= 1
    ) {
      return;
    }
    this.fitAddon.fit();
    const cols = clamp(this.terminal.cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
    const rows = clamp(this.terminal.rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
    if (cols !== this.terminal.cols || rows !== this.terminal.rows) {
      this.terminal.resize(cols, rows);
    }
    this.callbacks?.setViewportSize(cols, rows);
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.transport.resize(cols, rows);
    }, BACKEND_RESIZE_DEBOUNCE_MS);
  }
}
