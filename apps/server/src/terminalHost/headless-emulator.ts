// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/headless-emulator.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: trimmed to the snapshot core — dropped the OSC cwd/title
// scanner, OSC link ranges, view-attribute responder, ConPTY DA1 override,
// kitty keyboard reseed, orca unicode provider, and
// prompt-line inspection. Dropped the Node window polyfill because current
// @xterm/headless runs without browser globals. Rendering/parsing stays 100%
// inside @xterm public addons. No xterm private API is read here.

import { createRequire } from "node:module";
import { TERMINAL_AGENT_SCROLLBACK_ROWS } from "@agent-group/shared/terminalAgent";
import type * as XtermHeadless from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { serializeWithAbsoluteCursor } from "./terminal-serialize-absolute-cursor";
import { advancePartialEscapeTail } from "./terminal-partial-escape-tail";
import { buildRehydrateSequences } from "./terminal-mode-rehydrate-sequences";
import { TerminalMouseModeMirror } from "./terminal-mouse-mode-mirror";
import { splitTerminalSnapshotAnsi } from "./terminal-snapshot-ansi-buffers";
import type { TerminalSnapshot } from "./terminal-snapshot";
import type { TerminalModes } from "./terminal-modes";

// Local change: @xterm/headless publishes CommonJS without Node-detectable
// named exports. createRequire keeps both Bun source execution and the built
// Node ESM entrypoint on the package's supported loading path.
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof XtermHeadless;

export type HeadlessEmulatorOptions = {
  cols: number;
  rows: number;
  scrollback?: number;
  onQueryReply?: (reply: string) => void;
};

export type HeadlessEmulatorWriteOptions = {
  /** Only live PTY output may answer terminal capability queries. */
  forwardQueryReplies?: boolean;
};

export class HeadlessEmulator {
  private terminal: XtermHeadless.Terminal;
  private serializer: SerializeAddon;
  private mouseModes = new TerminalMouseModeMirror();
  private disposed = false;
  private onQueryReply: ((reply: string) => void) | null;
  private queryReplyForwardingDepth = 0;
  // Why: a mid-escape chunk tail lives in xterm's parser, not the buffer, so
  // serialize() drops it and it renders literal after restore (Bug E).
  private partialEscapeTail = "";

  constructor(opts: HeadlessEmulatorOptions) {
    this.terminal = new Terminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: opts.scrollback ?? TERMINAL_AGENT_SCROLLBACK_ROWS,
      allowProposedApi: true,
      logLevel: "off",
      vtExtensions: { kittyKeyboard: true },
    } as ConstructorParameters<typeof Terminal>[0]);

    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);

    // Why Unicode 11: must match the renderer's char-width measurement, else
    // emoji rows mismeasure and the mirror accumulates cell-shifted tears.
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";

    this.onQueryReply = opts.onQueryReply ?? null;
    if (this.onQueryReply) {
      this.terminal.onData((reply) => {
        if (this.queryReplyForwardingDepth > 0) {
          this.onQueryReply?.(reply);
        }
      });
    }
  }

  write(data: string, opts: HeadlessEmulatorWriteOptions = {}): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const forwardQueryReplies = opts.forwardQueryReplies === true;
    if (forwardQueryReplies) {
      // The empty sentinel opens the forwarding window in xterm's FIFO
      // immediately before this exact live chunk is parsed.
      this.terminal.write("", () => {
        this.queryReplyForwardingDepth += 1;
      });
    }
    return new Promise<void>((resolve) => {
      this.terminal.write(data, () => {
        if (forwardQueryReplies) {
          this.queryReplyForwardingDepth -= 1;
        }
        // Why: commit the mirrors only after xterm has parsed the same bytes
        // (snapshots combine both).
        this.mouseModes.scan(data);
        this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data);
        resolve();
      });
    });
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      return;
    }
    this.terminal.resize(cols, rows);
  }

  // Why: these dims proxy the child's real size, so they stay stale on a
  // dropped resize the renderer must detect.
  getAppliedSize(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  getSnapshot(opts: { scrollbackRows?: number; outputSequence: number }): TerminalSnapshot {
    const modes = this.getModes();
    // Why absolute: relative cursor restore is off by a column after a
    // wrap-pending final row; saved-cursor rides along for DECRC.
    const serializedAnsi = serializeWithAbsoluteCursor(
      this.serializer,
      this.terminal,
      // Local change: exactOptionalPropertyTypes forbids an explicit
      // undefined scrollback, so only pass the option when set.
      opts.scrollbackRows !== undefined ? { scrollback: opts.scrollbackRows } : {},
    );
    const { snapshotAnsi, scrollbackAnsi } = splitTerminalSnapshotAnsi(serializedAnsi, modes);
    return {
      snapshotAnsi,
      scrollbackAnsi,
      rehydrateSequences: buildRehydrateSequences(modes),
      modes,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      scrollbackLines: this.terminal.buffer.normal.length - this.terminal.rows,
      outputSequence: opts.outputSequence,
      // Why written LAST by the restorer: the next live chunk must complete
      // this dangling sequence, not render it literally (Bug E).
      ...(this.partialEscapeTail.length > 0
        ? { pendingEscapeTailAnsi: this.partialEscapeTail }
        : {}),
    };
  }

  get isAlternateScreen(): boolean {
    return this.terminal.buffer.active.type === "alternate";
  }

  /** Dangling incomplete escape at the stream position; handoffs seed the
   *  other side so a split sequence isn't lost. */
  get partialEscapeTailAnsi(): string {
    return this.partialEscapeTail;
  }

  getVisibleLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = buffer.viewportY; row < buffer.viewportY + this.terminal.rows; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return lines;
  }

  clearScrollback(): void {
    this.terminal.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.onQueryReply = null;
    this.terminal.dispose();
  }

  private getModes(): TerminalModes {
    const buffer = this.terminal.buffer.active;
    const mouseTrackingMode = this.terminal.modes.mouseTrackingMode;
    return {
      bracketedPaste: this.terminal.modes.bracketedPasteMode,
      mouseTracking: mouseTrackingMode !== "none",
      mouseTrackingMode,
      sgrMouseMode: this.mouseModes.sgrMouseMode,
      sgrMousePixelsMode: this.mouseModes.sgrMousePixelsMode,
      applicationCursor:
        buffer.type === "normal" ? this.terminal.modes.applicationCursorKeysMode : false,
      alternateScreen: buffer.type === "alternate",
    };
  }
}
