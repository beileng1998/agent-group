import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = [
    ["goal", "TEXT"],
    ["goal_started_at", "TEXT"],
    ["goal_paused_at", "TEXT"],
    ["goal_achievements_json", "TEXT"],
  ] as const;
  for (const [name, type] of columns) {
    if (!(yield* columnExists(sql, "projection_threads", name))) {
      yield* sql.unsafe(`ALTER TABLE projection_threads ADD COLUMN ${name} ${type}`);
    }
  }
});
