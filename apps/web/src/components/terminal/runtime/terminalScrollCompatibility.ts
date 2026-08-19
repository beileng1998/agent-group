import type { Terminal } from "@xterm/xterm";

export const TERMINAL_SCROLL_SENSITIVITY = 1.25;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_UP_BUTTON = 64;
const WHEEL_DOWN_BUTTON = 65;
const ALT_MODIFIER = 8;
const CTRL_MODIFIER = 16;

export interface TerminalWheelLineState {
  context: string;
  partialLines: number;
}

interface TerminalWheelLineInput {
  altKey: boolean;
  ctrlKey: boolean;
  deltaMode: number;
  deltaY: number;
}

interface TerminalWheelLineContext {
  cellHeight: number;
  context: string;
  fastScrollSensitivity: number;
  rows: number;
  scrollSensitivity: number;
}

interface TerminalCellGeometry {
  height: number;
  screen: HTMLElement;
  width: number;
}

type SgrMouseEncoding = "cell" | "pixel" | null;

export function createTerminalWheelLineState(): TerminalWheelLineState {
  return { context: "", partialLines: 0 };
}

export function consumeTerminalWheelLines(
  state: TerminalWheelLineState,
  input: TerminalWheelLineInput,
  context: TerminalWheelLineContext,
): number {
  if (state.context !== context.context) {
    state.context = context.context;
    state.partialLines = 0;
  }

  const sensitivity =
    input.altKey || input.ctrlKey
      ? context.scrollSensitivity * context.fastScrollSensitivity
      : context.scrollSensitivity;
  let lines = input.deltaY * sensitivity;
  if (input.deltaMode === DOM_DELTA_PAGE) {
    lines *= context.rows;
  } else if (input.deltaMode !== DOM_DELTA_LINE) {
    lines /= context.cellHeight;
  }

  state.partialLines += lines;
  let wholeLines = Math.trunc(state.partialLines);
  state.partialLines -= wholeLines;

  const limit = Math.max(1, context.rows);
  if (Math.abs(wholeLines) > limit) {
    wholeLines = Math.sign(wholeLines) * limit;
    state.partialLines = 0;
  }
  return wholeLines;
}

export function buildTerminalArrowSequence(
  direction: number,
  applicationCursorKeys: boolean,
): string {
  return `\x1b${applicationCursorKeys ? "O" : "["}${direction < 0 ? "A" : "B"}`;
}

export function buildTerminalSgrWheelReport(
  direction: number,
  x: number,
  y: number,
  modifiers: { altKey: boolean; ctrlKey: boolean },
): string {
  let button = direction < 0 ? WHEEL_UP_BUTTON : WHEEL_DOWN_BUTTON;
  if (modifiers.altKey) button |= ALT_MODIFIER;
  if (modifiers.ctrlKey) button |= CTRL_MODIFIER;
  return `\x1b[<${button};${x};${y}M`;
}

function getTerminalCellGeometry(terminal: Terminal): TerminalCellGeometry | null {
  const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen || terminal.cols <= 0 || terminal.rows <= 0) return null;
  const rect = screen.getBoundingClientRect();
  const width = rect.width / terminal.cols;
  const height = rect.height / terminal.rows;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { height, screen, width };
}

function getMouseReportCoordinates(
  terminal: Terminal,
  geometry: TerminalCellGeometry,
  event: WheelEvent,
  encoding: Exclude<SgrMouseEncoding, null>,
): { x: number; y: number } {
  const rect = geometry.screen.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
  const offsetY = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
  if (encoding === "pixel") {
    return { x: Math.floor(offsetX), y: Math.floor(offsetY) };
  }
  return {
    x: Math.max(0, Math.min(terminal.cols - 1, Math.floor(offsetX / geometry.width))),
    y: Math.max(0, Math.min(terminal.rows - 1, Math.floor(offsetY / geometry.height))),
  };
}

function trackSgrMouseEncoding(terminal: Terminal): {
  dispose: () => void;
  get: () => SgrMouseEncoding;
} {
  let encoding: SgrMouseEncoding = null;
  const modesFromParams = (params: (number | number[])[]) =>
    params.flatMap((param) => (Array.isArray(param) ? param : [param]));
  const set = terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    for (const mode of modesFromParams(params)) {
      if (mode === 1006) encoding = "cell";
      if (mode === 1016) encoding = "pixel";
    }
    return false;
  });
  const reset = terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    if (modesFromParams(params).some((mode) => mode === 1006 || mode === 1016)) {
      encoding = null;
    }
    return false;
  });
  const fullReset = terminal.parser.registerEscHandler({ final: "c" }, () => {
    encoding = null;
    return false;
  });
  return {
    get: () => encoding,
    dispose: () => {
      set.dispose();
      reset.dispose();
      fullReset.dispose();
    },
  };
}

/**
 * Restores full wheel deltas for TUIs. xterm keeps normal-buffer scrollback,
 * while captured wheel input is converted to one report or arrow per line.
 */
export function installTerminalScrollCompatibility(terminal: Terminal): () => void {
  const encoding = trackSgrMouseEncoding(terminal);
  const state = createTerminalWheelLineState();

  terminal.attachCustomWheelEventHandler((event) => {
    if (event.deltaY === 0 || event.shiftKey) return true;

    const bufferType = terminal.buffer.active.type;
    const mouseTracking = terminal.modes.mouseTrackingMode;
    const sendsWheelReports =
      mouseTracking === "vt200" || mouseTracking === "drag" || mouseTracking === "any";
    const sgrEncoding = encoding.get();
    if (sendsWheelReports ? sgrEncoding === null : bufferType !== "alternate") return true;

    const geometry = getTerminalCellGeometry(terminal);
    if (!geometry) return true;
    const applicationCursorKeys = terminal.modes.applicationCursorKeysMode;
    const lines = consumeTerminalWheelLines(
      state,
      {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        deltaMode: event.deltaMode,
        deltaY: event.deltaY,
      },
      {
        cellHeight: geometry.height,
        context: `${bufferType}:${mouseTracking}:${sgrEncoding}:${applicationCursorKeys}`,
        fastScrollSensitivity: terminal.options.fastScrollSensitivity ?? 5,
        rows: terminal.rows,
        scrollSensitivity: terminal.options.scrollSensitivity ?? 1,
      },
    );

    if (lines !== 0) {
      const sequence = sendsWheelReports
        ? (() => {
            const coords = getMouseReportCoordinates(terminal, geometry, event, sgrEncoding!);
            return buildTerminalSgrWheelReport(lines, coords.x, coords.y, event);
          })()
        : buildTerminalArrowSequence(lines, applicationCursorKeys);
      terminal.input(sequence.repeat(Math.abs(lines)), true);
    }

    event.preventDefault();
    event.stopPropagation();
    return false;
  });

  return () => {
    encoding.dispose();
    terminal.attachCustomWheelEventHandler(() => true);
  };
}
