// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/terminal-snapshot.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: dropped oscLinks/cwd/lastTitle (their producers were trimmed);
// outputSequence is required here — the host always stamps the monotonic output
// sequence at capture time so attach clients can drop seq <= outputSequence.

import type { TerminalModes } from './terminal-modes'

export type TerminalSnapshot = {
  snapshotAnsi: string
  /** Parser tail is already counted by the snapshot sequence and must restore last. */
  pendingEscapeTailAnsi?: string
  /** Normal buffer captured separately while snapshotAnsi holds an alternate buffer. */
  scrollbackAnsi: string
  rehydrateSequences: string
  modes: TerminalModes
  cols: number
  rows: number
  scrollbackLines: number
  /** Monotonic output sequence at capture time; clients ignore live output with seq <= this. */
  outputSequence: number
}
