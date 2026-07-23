import { WsRpcError } from "@agent-group/contracts";
import { Effect } from "effect";

import type { LiveUiStreamDropReport } from "../wsStreamBackpressure";

export {
  isShellRelevantEvent,
  isThreadDetailEvent,
  isThreadDetailEventFor,
  makeShellStreamProjector,
} from "../orchestration/remoteEventProjection";

export const failLiveUiStreamForSnapshotResync = (report: LiveUiStreamDropReport) =>
  Effect.fail(
    new WsRpcError({
      message: `${report.message}; restarting stream to refresh snapshot.`,
    }),
  );
