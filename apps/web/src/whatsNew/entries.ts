// FILE: whatsNew/entries.ts
// Purpose: Curated Agent Group release notes shown after updates and in Settings.
// Layer: Static data consumed by the What's New surfaces.

import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.6.0",
    date: "Jul 18",
    features: [
      {
        id: "agent-group-identity",
        title: "Agent Group has its own identity",
        description:
          "A new session-tree mark now appears across the desktop app, web app, marketing site, launch screen, and release artifacts.",
        details:
          "Four progressively indented lines express the Group and Session hierarchy. One editable vector source drives every platform asset, while build and runtime paths no longer point at the inherited Agent Group artwork.",
      },
      {
        id: "agent-group-session-management",
        title: "Groups stay organized",
        description:
          "Pin, reorder, and remove Groups and Sessions directly from the workspace sidebar.",
        details:
          "Management behavior now lives in focused modules with guarded deletion and durable ordering, keeping the sidebar easier to extend as Agent Group grows.",
      },
      {
        id: "context-turn-recovery",
        title: "Context tracks what an Agent actually saw",
        description:
          "Context awareness advances only after a successful Turn and safely recovers interrupted work after a restart.",
        details:
          "Each Turn freezes the exact Context Git head it received. Failed or cancelled work leaves that head unseen, while a small persisted runtime marker lets the next Turn recover conservatively without calling a model.",
      },
      {
        id: "agent-group-polish",
        title: "A quieter, more consistent workspace",
        description:
          "Open and close motion now feels consistent, while unused event streams stay dormant until a screen needs them.",
        details:
          "Sidebars, environment surfaces, terminal layers, and disclosures share one motion primitive. WebSocket RPC errors and desktop update metadata also retain the details needed for reliable recovery.",
      },
    ],
  },
];
