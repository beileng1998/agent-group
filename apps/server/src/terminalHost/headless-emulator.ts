// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/headless-emulator.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: trimmed to the snapshot core — dropped the OSC cwd/title
// scanner, OSC link ranges, view-attribute responder, ConPTY DA1 override,
// kitty keyboard reseed, orca unicode provider, query-reply forwarding, and
// prompt-line inspection. Rendering/parsing stays 100% inside @xterm public
// addons; the only private reads are the guarded writeSync and DECSC register
// probes, each with a public fallback (see terminal-serialize-absolute-cursor).

import './xterm-env-polyfill'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import {
  readSavedCursorRegister,
  serializeWithAbsoluteCursor
} from './terminal-serialize-absolute-cursor'
import { advancePartialEscapeTail } from './terminal-partial-escape-tail'
import { buildRehydrateSequences } from './terminal-mode-rehydrate-sequences'
import { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import { splitTerminalSnapshotAnsi } from './terminal-snapshot-ansi-buffers'
import type { TerminalSnapshot } from './terminal-snapshot'
import type { TerminalModes } from './terminal-modes'

export type HeadlessEmulatorOptions = {
  cols: number
  rows: number
  scrollback?: number
}

type TerminalWithSynchronousWrite = Terminal & {
  _core?: {
    writeSync?: (data: string) => void
  }
}

const DEFAULT_SCROLLBACK = 5000

export class HeadlessEmulator {
  private terminal: Terminal
  private serializer: SerializeAddon
  private mouseModes = new TerminalMouseModeMirror()
  private disposed = false
  // Why: a mid-escape chunk tail lives in xterm's parser, not the buffer, so
  // serialize() drops it and it renders literal after restore (Bug E).
  private partialEscapeTail = ''

  constructor(opts: HeadlessEmulatorOptions) {
    this.terminal = new Terminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: opts.scrollback ?? DEFAULT_SCROLLBACK,
      allowProposedApi: true,
      logLevel: 'off'
    })

    this.serializer = new SerializeAddon()
    this.terminal.loadAddon(this.serializer)

    // Why Unicode 11: must match the renderer's char-width measurement, else
    // emoji rows mismeasure and the mirror accumulates cell-shifted tears.
    this.terminal.loadAddon(new Unicode11Addon())
  }

  write(data: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.terminal.write(data, () => {
        // Why: commit the mirrors only after xterm has parsed the same bytes
        // (snapshots combine both).
        this.mouseModes.scan(data)
        this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data)
        resolve()
      })
    })
  }

  /** Synchronous write for restore replay (async would snapshot a half-applied
   *  stream); false when writeSync is unavailable. Guarded private read with a
   *  public async fallback — see write(). */
  writeSync(data: string): boolean {
    if (this.disposed) {
      return false
    }
    const writeSync = (this.terminal as TerminalWithSynchronousWrite)._core?.writeSync
    if (typeof writeSync !== 'function') {
      return false
    }
    // Why: restore snapshots are requested right after PTY bursts; queued
    // writes could snapshot half-cleared TUI rows.
    writeSync.call((this.terminal as TerminalWithSynchronousWrite)._core, data)
    this.mouseModes.scan(data)
    this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data)
    return true
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      return
    }
    this.terminal.resize(cols, rows)
  }

  // Why: these dims proxy the child's real size, so they stay stale on a
  // dropped resize the renderer must detect.
  getAppliedSize(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows }
  }

  getSnapshot(opts: { scrollbackRows?: number; outputSequence: number }): TerminalSnapshot {
    const modes = this.getModes()
    // Why absolute: relative cursor restore is off by a column after a
    // wrap-pending final row; saved-cursor rides along for DECRC.
    const serializedAnsi = serializeWithAbsoluteCursor(
      this.serializer,
      this.terminal,
      // Local change: exactOptionalPropertyTypes forbids an explicit
      // undefined scrollback, so only pass the option when set.
      opts.scrollbackRows !== undefined ? { scrollback: opts.scrollbackRows } : {},
      readSavedCursorRegister(this.terminal)
    )
    const { snapshotAnsi, scrollbackAnsi } = splitTerminalSnapshotAnsi(serializedAnsi, modes)
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
        : {})
    }
  }

  get isAlternateScreen(): boolean {
    return this.terminal.buffer.active.type === 'alternate'
  }

  /** Dangling incomplete escape at the stream position; handoffs seed the
   *  other side so a split sequence isn't lost. */
  get partialEscapeTailAnsi(): string {
    return this.partialEscapeTail
  }

  getVisibleLines(): string[] {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let row = buffer.viewportY; row < buffer.viewportY + this.terminal.rows; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return lines
  }

  clearScrollback(): void {
    this.terminal.clear()
  }

  dispose(): void {
    this.disposed = true
    this.terminal.dispose()
  }

  private getModes(): TerminalModes {
    const buffer = this.terminal.buffer.active
    const mouseTrackingMode = this.mouseModes.mouseTrackingMode
    return {
      bracketedPaste: this.terminal.modes.bracketedPasteMode,
      mouseTracking: mouseTrackingMode !== 'none',
      mouseTrackingMode,
      sgrMouseMode: this.mouseModes.sgrMouseMode,
      sgrMousePixelsMode: this.mouseModes.sgrMousePixelsMode,
      applicationCursor:
        buffer.type === 'normal' ? this.terminal.modes.applicationCursorKeysMode : false,
      alternateScreen: buffer.type === 'alternate'
    }
  }
}
