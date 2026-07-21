import type { ProfileStats } from "@agent-group/contracts";

export type HeatmapCell = ProfileStats["activity"]["heatmap"][number];

export interface CountRow {
  readonly count: number;
}

export interface PromptActivityRow extends CountRow {
  readonly day: string | null;
  readonly hour: number | null;
}

export interface TurnInsightRow extends CountRow {
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
}

export interface SkillUsageMessageRow {
  readonly messageId: string | null;
  readonly text: string | null;
  readonly skillsJson: string | null;
  readonly mentionsJson: string | null;
}

// Pre-aggregated usage snapshotted from purged threads.
export interface ArchivedSkillUsageRow {
  readonly name: string | null;
  readonly kind: string | null;
  readonly runCount: number;
}

export interface MostWorkedProjectRow {
  readonly projectId: string | null;
  readonly title: string | null;
  readonly workspaceRoot: string | null;
  readonly promptCount: number;
  readonly threadCount: number;
  readonly activeDays: number;
  readonly lastWorkedAt: string | null;
}

export interface TokenDayRow {
  readonly day: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tokens: number;
}
