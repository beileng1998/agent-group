import nodePath from "node:path";

import type { ProfileStats, StatsGetProfileStatsInput } from "@agent-group/contracts";

import { aggregatePromptActivity } from "./profileActivityMetrics";
import { aggregateProviderInsights } from "./profileProviderInsights";
import { aggregateProfileSkillUsageRows } from "./profileSkillUsage";
import type {
  ArchivedSkillUsageRow,
  CountRow,
  MostWorkedProjectRow,
  PromptActivityRow,
  SkillUsageMessageRow,
  TurnInsightRow,
} from "./profileStatsRows";
import {
  buildMostWorkedProject,
  deriveInitials,
  emptyQuota,
  localToday,
  num,
  sanitizeHandle,
} from "./profileStatsValues";

const SKILL_RESULT_LIMIT = 12;

export interface ProfileStatsResultInput {
  readonly input: StatsGetProfileStatsInput;
  readonly homeDir: string;
  readonly promptActivityRows: ReadonlyArray<PromptActivityRow>;
  readonly totalThreadRows: ReadonlyArray<CountRow>;
  readonly turnInsightRows: ReadonlyArray<TurnInsightRow>;
  readonly skillMessageRows: ReadonlyArray<SkillUsageMessageRow>;
  readonly archivedSkillRows: ReadonlyArray<ArchivedSkillUsageRow>;
  readonly mostWorkedProjectRows: ReadonlyArray<MostWorkedProjectRow>;
}

export function buildProfileStatsResult(values: ProfileStatsResultInput): ProfileStats {
  const todayKey = localToday(values.input.utcOffsetMinutes);
  const activity = aggregatePromptActivity(values.promptActivityRows, todayKey);
  const providerInsights = aggregateProviderInsights(values.turnInsightRows);
  const allSkillUsages = aggregateProfileSkillUsageRows(
    values.skillMessageRows,
    values.archivedSkillRows,
  );
  const skills = allSkillUsages.slice(0, SKILL_RESULT_LIMIT);
  const totalSkillsUsed = allSkillUsages.reduce((sum, row) => sum + row.runCount, 0);
  const homeDirBasename = nodePath.basename(values.homeDir) || "agent-group";

  return {
    generatedAt: new Date().toISOString(),
    timezone: { utcOffsetMinutes: values.input.utcOffsetMinutes, today: todayKey },
    identity: {
      homeDirBasename,
      initials: deriveInitials(homeDirBasename),
      defaultHandle: sanitizeHandle(homeDirBasename),
    },
    activity: {
      currentStreakDays: activity.currentStreakDays,
      longestStreakDays: activity.longestStreakDays,
      totalPromptsSent: activity.totalPromptsSent,
      totalThreads: num(values.totalThreadRows[0]?.count),
      promptsToday: activity.countByDay.get(todayKey) ?? 0,
      heatmapMetric: "prompts",
      heatmap: activity.heatmap,
    },
    activeHours: activity.activeHours,
    insights: {
      topProvider: providerInsights.topProvider,
      topProviderPercent: providerInsights.topProviderPercent,
      topReasoning: providerInsights.topReasoning,
      topReasoningPercent: providerInsights.topReasoningPercent,
      skillsExplored: allSkillUsages.length,
      totalSkillsUsed,
    },
    providerModels: providerInsights.providerModels,
    skills,
    mostUsedSkill: skills[0] ?? null,
    mostWorkedProject: buildMostWorkedProject(values.mostWorkedProjectRows[0]),
    quota: emptyQuota(),
  } satisfies ProfileStats;
}
