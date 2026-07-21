import type {
  ProfileStats,
  ProfileTokenStats,
  StatsGetProfileStatsInput,
  StatsGetProfileTokenStatsInput,
} from "@agent-group/contracts";
import { Effect, Layer, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config";
import { makeProfileStatsQueries } from "./profileStatsQueries";
import { buildProfileStatsResult } from "./profileStatsResult";
import { buildProfileTokenStatsResult } from "./profileTokenStatsResult";
import { sqliteModifierFromUtcOffsetMinutes } from "./profileStatsValues";

export interface ProfileStatsQueryShape {
  readonly getProfileStats: (
    input: StatsGetProfileStatsInput,
  ) => Effect.Effect<ProfileStats, unknown>;
  readonly getProfileTokenStats: (
    input: StatsGetProfileTokenStatsInput,
  ) => Effect.Effect<ProfileTokenStats, unknown>;
}

export class ProfileStatsQuery extends ServiceMap.Service<
  ProfileStatsQuery,
  ProfileStatsQueryShape
>()("agent-group/profileStats/ProfileStatsQuery") {}

const makeProfileStatsQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig;
  const queries = makeProfileStatsQueries(sql);

  const getProfileStats = (
    input: StatsGetProfileStatsInput,
  ): Effect.Effect<ProfileStats, unknown> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const promptActivityRows = yield* queries.queryPromptActivity(tz);
      const totalThreadRows = yield* queries.queryTotalThreads();
      const turnInsightRows = yield* queries.queryTurnInsights();
      const skillMessageRows = yield* queries.querySkillUsageMessages();
      const archivedSkillRows = yield* queries.queryArchivedSkillUsage();
      const mostWorkedProjectRows = yield* queries.queryMostWorkedProject(tz);
      return buildProfileStatsResult({
        input,
        homeDir: config.homeDir,
        promptActivityRows,
        totalThreadRows,
        turnInsightRows,
        skillMessageRows,
        archivedSkillRows,
        mostWorkedProjectRows,
      });
    });

  const getProfileTokenStats = (
    input: StatsGetProfileTokenStatsInput,
  ): Effect.Effect<ProfileTokenStats, unknown> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const rows = yield* queries.queryTokenActivity(tz);
      const turnInsightRows = yield* queries.queryTurnInsights();
      return buildProfileTokenStatsResult(input.utcOffsetMinutes, rows, turnInsightRows);
    });

  return { getProfileStats, getProfileTokenStats } satisfies ProfileStatsQueryShape;
});

export const ProfileStatsQueryLive = Layer.effect(ProfileStatsQuery, makeProfileStatsQuery);
