import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vitest";

import { runMigrations } from "../Migrations";
import * as NodeSqliteClient from "../NodeSqliteClient";

describe("056_ProjectionThreadsGoal", () => {
  it.effect("adds every persisted goal field idempotently", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`ALTER TABLE projection_threads ADD COLUMN goal TEXT`;
      yield* runMigrations({ toMigrationInclusive: 56 });

      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_threads')
      `;
      const names = columns.map((column) => column.name);
      assert.strictEqual(names.filter((name) => name === "goal").length, 1);
      assert.isTrue(names.includes("goal_started_at"));
      assert.isTrue(names.includes("goal_paused_at"));
      assert.isTrue(names.includes("goal_achievements_json"));
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
