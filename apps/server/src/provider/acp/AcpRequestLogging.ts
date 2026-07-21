import { Effect } from "effect";
import type * as EffectAcpErrors from "effect-acp/errors";

import type { AcpSessionRequestLogEvent } from "./AcpSessionRuntimeContracts.ts";

export function makeAcpLoggedRequest(
  requestLogger: ((event: AcpSessionRequestLogEvent) => Effect.Effect<void, never>) | undefined,
) {
  const logRequest = (event: AcpSessionRequestLogEvent) =>
    requestLogger ? requestLogger(event) : Effect.void;

  return <A>(
    method: string,
    payload: unknown,
    effect: Effect.Effect<A, EffectAcpErrors.AcpError>,
  ): Effect.Effect<A, EffectAcpErrors.AcpError> =>
    logRequest({ method, payload, status: "started" }).pipe(
      Effect.flatMap(() =>
        effect.pipe(
          Effect.tap((result) => logRequest({ method, payload, status: "succeeded", result })),
          Effect.onError((cause) => logRequest({ method, payload, status: "failed", cause })),
        ),
      ),
    );
}
