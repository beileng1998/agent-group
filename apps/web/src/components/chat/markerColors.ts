// FILE: markerColors.ts
// Purpose: Shared highlight-marker color palette for UI surfaces.
// Layer: Chat presentation helpers (Environment panel swatches, edit popover,
//        Appearance default-color picker).

import type { ThreadMarkerColor } from "@agent-group/contracts";

export const MARKER_COLORS: readonly ThreadMarkerColor[] = ["yellow", "blue", "green", "pink"];

// Hues match the transcript fill tokens in index.css (.thread-marker-{color}).
export const MARKER_SWATCH_CLASS: Record<ThreadMarkerColor, string> = {
  yellow: "bg-[#facc15]",
  blue: "bg-[#60a5fa]",
  green: "bg-[#34d399]",
  pink: "bg-[#f472b6]",
};
