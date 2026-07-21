import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { ProjectionSnapshotQueryShape } from "../../Services/ProjectionSnapshotQuery.ts";
import { makeLookupOperations } from "./lookupOperations.ts";
import { makeLookupQueries } from "./lookupQueries.ts";
import { makeSnapshotOperations } from "./snapshotOperations.ts";
import { makeSnapshotQueries } from "./snapshotQueries.ts";
import { makeThreadContextQueries } from "./threadContextQueries.ts";
import { makeThreadDetailQueries } from "./threadDetailQueries.ts";
import { makeThreadOperations } from "./threadOperations.ts";

export const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const queries = {
    ...makeSnapshotQueries(sql),
    ...makeLookupQueries(sql),
    ...makeThreadDetailQueries(sql),
    ...makeThreadContextQueries(sql),
  };
  return {
    ...makeSnapshotOperations({ sql, queries }),
    ...makeLookupOperations(queries),
    ...makeThreadOperations({ sql, queries }),
  } satisfies ProjectionSnapshotQueryShape;
});
