// FILE: rightDockPlacement.ts
// Purpose: Pure placement and sizing policy for the adaptive chat dock.
// Layer: Chat right-dock layout

export const RIGHT_DOCK_PLACEMENT_STORAGE_KEY = "agent-group:right-dock-placement:v1";

export type RightDockPlacementPreference = "auto" | "right" | "bottom";
export type RightDockPlacement = Exclude<RightDockPlacementPreference, "auto">;

export const RIGHT_DOCK_AUTO_BOTTOM_MAX_WIDTH_PX = 60 * 16;
export const RIGHT_DOCK_BOTTOM_MIN_HEIGHT_PX = 15 * 16;
export const RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX = 20 * 16;

export function resolveRightDockPlacement(input: {
  preference: RightDockPlacementPreference;
  hostWidth: number;
  hostHeight: number;
}): RightDockPlacement {
  if (input.preference !== "auto") return input.preference;
  if (input.hostWidth <= 0 || input.hostHeight <= 0) return "right";

  const isNarrow = input.hostWidth < RIGHT_DOCK_AUTO_BOTTOM_MAX_WIDTH_PX;
  const isPortrait = input.hostHeight > input.hostWidth;
  const canStack =
    input.hostHeight >= RIGHT_DOCK_BOTTOM_MIN_HEIGHT_PX + RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX;
  return canStack && (isNarrow || isPortrait) ? "bottom" : "right";
}

export function clampBottomDockHeight(requestedHeight: number, hostHeight: number): number {
  const maxHeight = Math.max(0, hostHeight - RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX);
  const minHeight = Math.min(RIGHT_DOCK_BOTTOM_MIN_HEIGHT_PX, maxHeight);
  if (!Number.isFinite(requestedHeight)) return minHeight;
  return Math.min(maxHeight, Math.max(minHeight, requestedHeight));
}

export function defaultBottomDockHeight(hostHeight: number): number {
  return clampBottomDockHeight(Math.round(hostHeight / 2), hostHeight);
}
