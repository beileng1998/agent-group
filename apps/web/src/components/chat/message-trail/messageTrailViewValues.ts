import type { MessageTrailItem } from "../messageTrail.logic";

export const MIN_PANE_WIDTH_PX = 864;
export const RAIL_WIDTH_PX = 56;
export const RAIL_MAX_HEIGHT_RATIO = 0.8;
export const TICK_LEFT_PAD_PX = 14;
export const TICK_HEIGHT_PX = 2;
export const TICK_SAVED_HEIGHT_PX = 3;
export const TICK_BASE_W = 6;
export const TICK_MAX_W = 30;
export const TICK_SPACING_PX = 10;
export const TICK_REST_OPACITY = 0.2;
export const TICK_VISIBLE_OPACITY = 0.52;
export const TICK_ANCHOR_OPACITY = 0.9;
export const TICK_SAVED_OPACITY = 0.72;
export const TICK_FOCUS_OPACITY = 1;
export const TOOLTIP_ESTIMATED_H_PX = 56;
export const TOOLTIP_OFFSET_X_PX = 8;

export function getMessageTrailTickHeight(kind: MessageTrailItem["kind"]): number {
  return kind === "turn" ? TICK_HEIGHT_PX : TICK_SAVED_HEIGHT_PX;
}
