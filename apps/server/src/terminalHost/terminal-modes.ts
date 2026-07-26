// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/terminal-modes.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: none.

export type TerminalModes = {
  bracketedPaste: boolean;
  mouseTracking: boolean;
  mouseTrackingMode?: "none" | "x10" | "vt200" | "drag" | "any";
  sgrMouseMode?: boolean;
  sgrMousePixelsMode?: boolean;
  applicationCursor: boolean;
  alternateScreen: boolean;
  /** Kitty keyboard protocol flags used only to reseed a warm daemon emulator. */
  kittyKeyboardFlags?: number;
};
