// VENDORED from stablyai/orca @ 8a236183 (src/main/daemon/xterm-env-polyfill.ts) — MIT © 2026 Lovecast Inc. See NOTICE.md.
// Local changes: none.

// @xterm/headless checks for `window` to detect browser vs node environment.
// In ELECTRON_RUN_AS_NODE mode, `window` is undefined. This polyfill must be
// imported before any @xterm/headless import.
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as Record<string, unknown>).window = globalThis
}

// Local change: keep this file a module so it never enters the global
// script set (a stray script shifts duplicate global resolution order).
export {}
