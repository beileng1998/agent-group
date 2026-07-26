// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/terminal-snapshot-ansi-buffers.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: TerminalModes import now resolves to ./terminal-modes.

import type { TerminalModes } from "./terminal-modes";

export function splitTerminalSnapshotAnsi(
  snapshotAnsi: string,
  modes: TerminalModes,
): { snapshotAnsi: string; scrollbackAnsi: string } {
  if (!modes.alternateScreen) {
    return { snapshotAnsi, scrollbackAnsi: "" };
  }
  const alternateScreenMarker = "\x1b[?1049h";
  const start = snapshotAnsi.lastIndexOf(alternateScreenMarker);
  if (start === -1) {
    return { snapshotAnsi, scrollbackAnsi: "" };
  }
  // Why: rehydrateSequences owns the alt-screen transition. Keeping the
  // normal buffer separate lets an already-alt renderer rebuild it safely.
  return {
    scrollbackAnsi: snapshotAnsi.slice(0, start),
    snapshotAnsi: snapshotAnsi.slice(start + alternateScreenMarker.length),
  };
}
