import { Cause, Duration, Effect, Layer, Option, Schedule } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ExecutionAdapterAuthority } from "../../orchestration/Services/ExecutionAdapterAuthority";
import type { ProviderRuntimeBinding } from "../Services/ProviderSessionDirectory";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper";
import { ProviderService } from "../Services/ProviderService";

const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const executionAdapterAuthority = yield* ExecutionAdapterAuthority;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);

    const isStale = (binding: ProviderRuntimeBinding, now: number) => {
      if (binding.status === "stopped" || !binding.lastSeenAt) return false;
      const lastSeenMs = Date.parse(binding.lastSeenAt);
      return !Number.isNaN(lastSeenMs) && now - lastSeenMs >= inactivityThresholdMs;
    };

    const stopIfStillStale = (threadId: ProviderRuntimeBinding["threadId"], now: number) =>
      Effect.gen(function* () {
        const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        if (!binding || !isStale(binding, now)) return;

        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(threadId)
          .pipe(Effect.map(Option.getOrUndefined));
        if (thread?.session?.activeTurnId != null) return;

        yield* providerService.stopSession({ threadId });
      });

    const reapCandidate = (binding: ProviderRuntimeBinding, now: number) =>
      Effect.acquireUseRelease(
        executionAdapterAuthority
          .acquireStructured(binding.threadId, `provider-session-reaper:${binding.threadId}`)
          .pipe(
            Effect.map(Option.some),
            Effect.catchTag("ExecutionAdapterAuthorityError", (error) =>
              error.reason === "authority-unavailable"
                ? Effect.logWarning("provider session reaper skipped unavailable authority", {
                    threadId: binding.threadId,
                  }).pipe(Effect.as(Option.none()))
                : Effect.succeed(Option.none()),
            ),
          ),
        (claim) =>
          Option.match(claim, {
            onNone: () => Effect.void,
            onSome: () => stopIfStillStale(binding.threadId, now),
          }),
        (claim) =>
          Option.match(claim, {
            onNone: () => Effect.void,
            onSome: (activeClaim) => activeClaim.release,
          }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider session reaper failed to stop stale session", {
            threadId: binding.threadId,
            provider: binding.provider,
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const sweep = Effect.gen(function* () {
      const bindings = yield* directory.listBindings();
      const now = Date.now();

      for (const binding of bindings) {
        if (!binding.lastSeenAt) continue;
        if (Number.isNaN(Date.parse(binding.lastSeenAt))) {
          yield* Effect.logWarning("provider session reaper skipped invalid timestamp", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }
        if (isStale(binding, now)) {
          yield* reapCandidate(binding, now);
        }
      }
    });

    const runSweepSafely = sweep.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider session reaper sweep failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.forkScoped(
        runSweepSafely.pipe(Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs)))),
      ).pipe(Effect.asVoid);

    return { start } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();
