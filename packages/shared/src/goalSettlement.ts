export const GOAL_ACHIEVED_MARKER = "<!-- agent-group-goal:achieved -->";
export const GOAL_BLOCKED_MARKER = "<!-- agent-group-goal:blocked -->";

export type GoalSettlement = "achieved" | "blocked" | null;

export function goalSettlementFromAssistantText(text: string): GoalSettlement {
  const normalized = text.trimEnd();
  if (normalized.endsWith(GOAL_ACHIEVED_MARKER)) return "achieved";
  if (normalized.endsWith(GOAL_BLOCKED_MARKER)) return "blocked";
  return null;
}

export function stripGoalSettlementMarker(text: string): string {
  const normalized = text.trimEnd();
  for (const marker of [GOAL_ACHIEVED_MARKER, GOAL_BLOCKED_MARKER]) {
    if (normalized.endsWith(marker)) {
      return normalized.slice(0, -marker.length).trimEnd();
    }
  }
  return text;
}
