import type { LookupQueries } from "./lookupQueries.ts";
import type { SnapshotQueries } from "./snapshotQueries.ts";
import type { ThreadContextQueries } from "./threadContextQueries.ts";
import type { ThreadDetailQueries } from "./threadDetailQueries.ts";

export type ProjectionQuerySet = LookupQueries &
  SnapshotQueries &
  ThreadContextQueries &
  ThreadDetailQueries;
