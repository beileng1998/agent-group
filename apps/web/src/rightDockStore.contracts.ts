// FILE: rightDockStore.contracts.ts
// Purpose: Defines right-dock pane kinds without depending on product-surface policy.
// Layer: UI state contracts

export const RIGHT_DOCK_PANE_KINDS = [
  "context",
  "highlights",
  "group",
  "browser",
  "diff",
  "explorer",
  "file",
  "terminal",
  "sidechat",
  "git",
  "pullRequest",
] as const;

export type RightDockPaneKind = (typeof RIGHT_DOCK_PANE_KINDS)[number];
