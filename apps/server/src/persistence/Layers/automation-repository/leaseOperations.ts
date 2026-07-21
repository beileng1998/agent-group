import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../../Errors.ts";
import {
  AcquireAutomationSchedulerLeaseInput,
  type AutomationRepositoryShape,
} from "../../Services/AutomationRepository.ts";

export function makeLeaseOperations(
  sql: SqlClient.SqlClient,
): Pick<AutomationRepositoryShape, "tryAcquireSchedulerLease"> {
  const acquireLease = SqlSchema.findAll({
    Request: AcquireAutomationSchedulerLeaseInput,
    Result: Schema.Struct({ changed: Schema.Number }),
    execute: ({ leaseKey, ownerId, now, leaseExpiresAt }) =>
      sql`
        INSERT INTO automation_scheduler_leases (
          lease_key,
          owner_id,
          acquired_at,
          heartbeat_at,
          lease_expires_at
        )
        VALUES (${leaseKey}, ${ownerId}, ${now}, ${now}, ${leaseExpiresAt})
        ON CONFLICT (lease_key)
        DO UPDATE SET
          owner_id = excluded.owner_id,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          lease_expires_at = excluded.lease_expires_at
        WHERE automation_scheduler_leases.owner_id = ${ownerId}
           OR automation_scheduler_leases.lease_expires_at <= ${now}
        RETURNING changes() AS changed
      `,
  });

  const tryAcquireSchedulerLease: AutomationRepositoryShape["tryAcquireSchedulerLease"] = (input) =>
    acquireLease(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.tryAcquireLease:query")),
      Effect.map((rows) => rows.length > 0),
    );

  return { tryAcquireSchedulerLease };
}
