// FILE: agentGroupLogoGeometry.ts
// Purpose: Shared geometry for the four-level Agent Group session-tree mark.

export const AGENT_GROUP_LOGO_BARS = [
  { x: 6, y: 10, width: 44, height: 8 },
  { x: 14, y: 22, width: 36, height: 8 },
  { x: 22, y: 34, width: 28, height: 8 },
  { x: 30, y: 46, width: 20, height: 8 },
] as const;

export const AGENT_GROUP_LOGO_BAR_RADIUS = 4;
