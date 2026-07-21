import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";

import { suppressQueryResponses } from "~/lib/suppressQueryResponses";

import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminalRuntimeAppearance";
import type { TerminalRuntimeConfig, TerminalRuntimeEntry } from "../terminalRuntimeTypes";
import {
  type AgentGroupTerminalOptions,
  TERMINAL_CURSOR_STYLE,
  TERMINAL_CURSOR_WIDTH,
  TERMINAL_INACTIVE_CURSOR_STYLE,
} from "./terminalRuntimeContract";
import { installTerminalRuntimeEventBridges } from "./terminalRuntimeEventBridge";
import { scheduleTerminalFontSettleRefit } from "./terminalRuntimePresentation";

export function createRuntimeEntry(config: TerminalRuntimeConfig): TerminalRuntimeEntry {
  const wrapper = document.createElement("div");
  wrapper.className = "h-full w-full";

  const fitAddon = new FitAddon();
  const clipboardAddon = new ClipboardAddon();
  const imageAddon = new ImageAddon();
  const searchAddon = new SearchAddon();
  const unicode11Addon = new Unicode11Addon();
  const terminalOptions: AgentGroupTerminalOptions = {
    cursorBlink: true,
    fontSize: getTerminalFontSizePx(),
    fontWeight: getTerminalFontWeight(),
    fontWeightBold: getTerminalBoldFontWeight(),
    scrollback: 5_000,
    fontFamily: getTerminalFontFamily(),
    theme: terminalThemeFromApp(),
    allowProposedApi: true,
    customGlyphs: true,
    macOptionIsMeta: false,
    cursorStyle: TERMINAL_CURSOR_STYLE,
    cursorInactiveStyle: TERMINAL_INACTIVE_CURSOR_STYLE,
    cursorWidth: TERMINAL_CURSOR_WIDTH,
    screenReaderMode: false,
    allowTransparency: false,
    vtExtensions: { kittyKeyboard: true },
    scrollbar: { showScrollbar: false },
  };
  const terminal = new Terminal(terminalOptions);
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(clipboardAddon);
  terminal.loadAddon(imageAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.unicode.activeVersion = "11";
  try {
    terminal.loadAddon(new LigaturesAddon());
  } catch {
    // Keep startup resilient when the active font does not support ligatures.
  }
  terminal.open(wrapper);

  const entry: TerminalRuntimeEntry = {
    runtimeKey: config.runtimeKey,
    threadId: config.threadId,
    terminalId: config.terminalId,
    terminalLabel: config.terminalLabel,
    terminalCliKind: config.terminalCliKind ?? null,
    cwd: config.cwd,
    callbacks: config.callbacks,
    wrapper,
    container: null,
    terminal,
    fitAddon,
    searchAddon,
    webglAddon: null,
    titleInputBuffer: "",
    hasHandledExit: false,
    runtimeStatus: "connecting",
    opened: false,
    disposed: false,
    resizeObserver: null,
    resizeDispatchTimer: null,
    visualResizeFrame: null,
    visualResizeTimer: null,
    lastVisualResizeAt: 0,
    lastSentResize: null,
    pendingResize: null,
    writeRafHandle: null,
    writeFlushTimeout: null,
    pendingWrites: [],
    pendingWriteLength: 0,
    pendingWriteBytes: 0,
    linkMatchCache: new Map(),
    outputEventVersion: 0,
    snapshotReconcileRequestId: 0,
    webglLoadFrame: null,
    themeRefreshFrame: 0,
    themeObserver: null,
    visibilityCleanup: null,
    terminalDisposables: [],
    attachDisposables: [],
    persistentDisposables: [],
    querySuppressionDispose: null,
    viewState: {
      autoFocus: false,
      isVisible: false,
    },
    unsubscribeTerminalEvents: null,
  };
  if (config.runtimeEnv !== undefined) {
    entry.runtimeEnv = config.runtimeEnv;
  }

  scheduleTerminalFontSettleRefit(entry);
  entry.querySuppressionDispose = suppressQueryResponses(terminal);
  installTerminalRuntimeEventBridges(entry);

  return entry;
}
