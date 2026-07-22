import { type ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import { ServerSettingsService } from "../serverSettings";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { resolveAgentGroupSessionCoordinates } from "./coordinates";
import { getAgentGroupSession } from "./runtime";

/** Shared read used by both the WS command plane and the HTTP bootstrap plane. */
export const queryAgentGroupSession = Effect.fn(function* (sessionId: ThreadId) {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const coordinates = yield* resolveAgentGroupSessionCoordinates(
    projectionSnapshotQuery,
    sessionId,
  );
  return yield* Effect.tryPromise(() =>
    getAgentGroupSession({
      ...coordinates,
      globalSettings: settings.agentGroup,
    }),
  );
});
