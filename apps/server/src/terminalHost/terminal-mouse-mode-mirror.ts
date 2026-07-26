// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/terminal-mouse-mode-mirror.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: tracks only SGR encodings that xterm's public modes omit.

// Why: PTY/SSH chunks can split a long combined DECSET before the final h/l.
// Keep parser state far beyond normal mode lists while still bounding memory.
const PRIVATE_MODE_SCAN_TAIL_LIMIT = 4096;

/**
 * Mirrors only the DECSET mouse encodings missing from xterm's public modes.
 * The tracking protocol itself comes directly from `Terminal.modes`.
 */
export class TerminalMouseModeMirror {
  private scanTail = "";
  private sgrMouseModeState = false;
  private sgrMousePixelsModeState = false;

  get sgrMouseMode(): boolean {
    return this.sgrMouseModeState;
  }

  get sgrMousePixelsMode(): boolean {
    return this.sgrMousePixelsModeState;
  }

  scan(data: string): void {
    // Why the pre-filter: this runs on the daemon's per-chunk hot path for
    // every session; a flood chunk with no private-mode/reset introducer
    // must not pay the regex pass (measured share of a 2.2x ingest
    // regression — findings log 2026-07-03). Split sequences stay correct:
    // an introducer split across chunks either left a non-empty scanTail
    // (previous partial) or ends this chunk, which extractScanTail retains.
    if (
      this.scanTail.length === 0 &&
      !data.includes("\x1b[?") &&
      !data.includes("\x1bc") &&
      !data.includes("\x9b")
    ) {
      this.scanTail = this.extractScanTail(data);
      return;
    }
    const input = this.scanTail.length === 0 ? data : this.scanTail + data;
    this.scanTail = this.extractScanTail(input);
    // oxlint-disable-next-line no-control-regex -- terminal escape sequences require control chars
    const privateModeRe = /\x1bc|\x1b\[\?([0-9;]+)([hl])|\x9b\?([0-9;]+)([hl])/g;
    let match: RegExpExecArray | null;
    while ((match = privateModeRe.exec(input)) !== null) {
      if (match[0] === "\x1bc") {
        this.sgrMouseModeState = false;
        this.sgrMousePixelsModeState = false;
        continue;
      }
      // Local change: `?? ''` — the non-`\x1bc` alternatives always populate a
      // params group, but noUncheckedIndexedAccess cannot see that.
      const params = match[1] ?? match[3] ?? "";
      const enabled = (match[2] ?? match[4]) === "h";
      for (const rawParam of params.split(";")) {
        if (rawParam === "") {
          continue;
        }
        const param = Number(rawParam);
        if (!Number.isInteger(param)) {
          continue;
        }
        if (param === 1006) {
          this.sgrMouseModeState = enabled;
          this.sgrMousePixelsModeState = false;
        }
        if (param === 1016) {
          this.sgrMouseModeState = false;
          this.sgrMousePixelsModeState = enabled;
        }
      }
    }
  }

  private extractScanTail(input: string): string {
    const start = Math.max(input.lastIndexOf("\x1b"), input.lastIndexOf("\x9b"));
    if (start === -1) {
      return "";
    }
    const tail = input.slice(start);
    if (tail.length > PRIVATE_MODE_SCAN_TAIL_LIMIT) {
      return "";
    }
    if (tail === "\x1b" || tail === "\x1b[" || tail === "\x9b") {
      return tail;
    }
    if (tail.startsWith("\x1b[?")) {
      return this.isIncompleteParams(tail.slice(3)) ? tail : "";
    }
    if (tail.startsWith("\x9b?")) {
      return this.isIncompleteParams(tail.slice(2)) ? tail : "";
    }
    return "";
  }

  private isIncompleteParams(params: string): boolean {
    return /^[0-9;]*$/.test(params);
  }
}
