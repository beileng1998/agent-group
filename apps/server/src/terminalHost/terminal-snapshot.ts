// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/terminal-snapshot.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: dropped oscLinks/cwd/lastTitle (their producers were trimmed);
// outputSequence is required here — the host always stamps the monotonic output
// sequence at capture time so attach clients can dedupe older bytes and detect
// a forward gap that requires a fresh snapshot.

import type { TerminalModes } from "./terminal-modes";

export type TerminalSnapshot = {
  snapshotAnsi: string;
  /** Parser tail is already counted by the snapshot sequence and must restore last. */
  pendingEscapeTailAnsi?: string;
  /** Normal buffer captured separately while snapshotAnsi holds an alternate buffer. */
  scrollbackAnsi: string;
  rehydrateSequences: string;
  modes: TerminalModes;
  cols: number;
  rows: number;
  scrollbackLines: number;
  /** Monotonic sequence at capture; clients dedupe older bytes and resync on gaps. */
  outputSequence: number;
};
