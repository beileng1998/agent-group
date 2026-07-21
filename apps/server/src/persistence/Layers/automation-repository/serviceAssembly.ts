import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../Errors.ts";
import type { AutomationRepositoryShape } from "../../Services/AutomationRepository.ts";
import { makeDefinitionOperations } from "./definitionOperations.ts";
import { makeDefinitionQueries } from "./definitionQueries.ts";
import { makeLeaseOperations } from "./leaseOperations.ts";
import { makeRunMutationQueries } from "./runMutationQueries.ts";
import { makeRunOperations } from "./runOperations.ts";
import { makeRunReadQueries } from "./runReadQueries.ts";
import { toDefinition, toRun } from "./rows.ts";

export const makeAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const definitionQueries = makeDefinitionQueries(sql);
  const definitionOperations = makeDefinitionOperations(definitionQueries);
  const runMutationQueries = makeRunMutationQueries(sql);
  const runReadQueries = makeRunReadQueries(sql);
  const { listRunRows, ...runOperations } = makeRunOperations(runMutationQueries, runReadQueries);
  const leaseOperations = makeLeaseOperations(sql);

  const list: AutomationRepositoryShape["list"] = (input = {}) => {
    const normalized = {
      projectId: input.projectId,
      includeArchived: input.includeArchived ?? false,
    };
    return Effect.all({
      definitions: definitionQueries
        .listDefinitionRows(normalized)
        .pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, toDefinition, { concurrency: "unbounded" }),
          ),
        ),
      runs: listRunRows(normalized).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, toRun, { concurrency: "unbounded" })),
      ),
    }).pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.list:query")));
  };

  return {
    ...definitionOperations,
    list,
    ...runOperations,
    ...leaseOperations,
  } satisfies AutomationRepositoryShape;
});
