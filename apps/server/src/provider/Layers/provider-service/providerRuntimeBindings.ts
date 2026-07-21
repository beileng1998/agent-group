import type { ProviderRuntimeEvent, ProviderSession, ThreadId } from "@agent-group/contracts";
import { Cause, Effect, Option, PubSub } from "effect";

import { isProviderChildRuntimeEvent } from "../../providerRuntimeEventScope.ts";
import {
  runtimeLastErrorForEvent,
  runtimePayloadRecord,
  runtimeStatusForEvent,
  shouldRefreshResumeCursorForEvent,
  toRuntimePayloadFromSession,
  toRuntimeStatus,
} from "../../providerRuntimeBinding.ts";
import {
  classifyTerminalTurnApplicability,
  isStartedTurnApplicable,
} from "../../terminalTurnApplicability.ts";
import type { ProviderRuntimeBinding } from "../../Services/ProviderSessionDirectory.ts";
import type { EventNdjsonLogger } from "../EventNdjsonLogger.ts";
import type {
  ProviderRuntimeIdleLifecycle,
  ProviderServiceDependencies,
  UpsertSessionBinding,
} from "./providerServiceTypes.ts";

export function makeProviderRuntimeBindings(input: {
  readonly dependencies: ProviderServiceDependencies;
  readonly idle: ProviderRuntimeIdleLifecycle;
  readonly runtimeEventPubSub: PubSub.PubSub<ProviderRuntimeEvent>;
  readonly canonicalEventLogger?: EventNdjsonLogger;
}) {
  const { registry, directory, bindingCoordinator, boundProvidersByThread } = input.dependencies;
  const withBindingWriteLock = bindingCoordinator.withWriteLock;

  const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.succeed(event).pipe(
      Effect.tap((canonicalEvent) =>
        input.canonicalEventLogger
          ? input.canonicalEventLogger.write(canonicalEvent, null)
          : Effect.void,
      ),
      Effect.flatMap((canonicalEvent) => PubSub.publish(input.runtimeEventPubSub, canonicalEvent)),
      Effect.asVoid,
    );

  const upsertSessionBinding: UpsertSessionBinding = (session, threadId, extra) =>
    directory
      .upsert({
        threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: toRuntimePayloadFromSession(session, extra),
      })
      .pipe(
        Effect.tap(() => Effect.sync(() => boundProvidersByThread.set(threadId, session.provider))),
      );

  const upsertStoppedSessionBinding = (session: ProviderSession, stoppedAt: string) =>
    directory.upsert({
      threadId: session.threadId,
      provider: session.provider,
      runtimeMode: session.runtimeMode,
      status: "stopped",
      ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
      runtimePayload: {
        ...toRuntimePayloadFromSession(session, {
          lastRuntimeEvent: "provider.stopAll",
          lastRuntimeEventAt: stoppedAt,
        }),
        activeTurnId: null,
      },
    });

  const markPersistedThreadStopped = (threadId: ThreadId, stoppedAt: string) =>
    directory.getProvider(threadId).pipe(
      Effect.flatMap((provider) =>
        directory.upsert({
          threadId,
          provider,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.stopAll",
            lastRuntimeEventAt: stoppedAt,
          },
        }),
      ),
    );

  const refreshResumeCursorFromActiveSession = (
    event: ProviderRuntimeEvent,
    binding: ProviderRuntimeBinding,
  ): Effect.Effect<unknown | null | undefined> => {
    if (!shouldRefreshResumeCursorForEvent(event)) {
      return Effect.succeed(binding.resumeCursor);
    }
    return Effect.gen(function* () {
      const adapter = yield* registry.getByProvider(binding.provider);
      const sessions = yield* adapter.listSessions();
      const activeSession = sessions.find((session) => session.threadId === event.threadId);
      return activeSession?.resumeCursor ?? binding.resumeCursor;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider.session.resume_cursor_refresh_failed", {
          threadId: event.threadId,
          provider: binding.provider,
          eventType: event.type,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(binding.resumeCursor)),
      ),
    );
  };

  const updateSessionBindingFromRuntimeEvent = (
    event: ProviderRuntimeEvent,
  ): Effect.Effect<boolean> => {
    switch (event.type) {
      case "session.started":
      case "session.state.changed":
      case "thread.started":
      case "thread.state.changed":
      case "turn.started":
      case "turn.tasks.updated":
      case "model.rerouted":
      case "turn.completed":
      case "turn.aborted":
      case "session.exited":
      case "runtime.error":
        break;
      default:
        return Effect.succeed(true);
    }

    return withBindingWriteLock(
      event.threadId,
      Effect.gen(function* () {
        const binding = Option.getOrUndefined(yield* directory.getBinding(event.threadId));
        if (!binding) {
          if (
            (event.type === "turn.completed" || event.type === "turn.aborted") &&
            event.turnId !== undefined
          ) {
            bindingCoordinator.recordSettledTurn(event.threadId, String(event.turnId));
          }
          return true;
        }
        if (binding.provider !== event.provider) return false;

        if (
          (event.type === "turn.completed" || event.type === "turn.aborted") &&
          event.turnId !== undefined
        ) {
          bindingCoordinator.recordSettledTurn(event.threadId, String(event.turnId));
        }

        const currentActiveTurnId =
          runtimePayloadRecord(binding.runtimePayload).activeTurnId ?? null;
        if (
          event.type === "turn.started" &&
          !isStartedTurnApplicable({
            activeTurnId: typeof currentActiveTurnId === "string" ? currentActiveTurnId : undefined,
            eventTurnId: event.turnId === undefined ? undefined : String(event.turnId),
          })
        ) {
          return false;
        }
        if (event.type === "turn.completed" || event.type === "turn.aborted") {
          const applicability = classifyTerminalTurnApplicability({
            activeTurnId: typeof currentActiveTurnId === "string" ? currentActiveTurnId : undefined,
            eventTurnId: event.turnId === undefined ? undefined : String(event.turnId),
          });
          if (!applicability.applicable) return false;
          if (event.turnId === undefined && applicability.resolvedTurnId !== undefined) {
            bindingCoordinator.recordSettledTurn(event.threadId, applicability.resolvedTurnId);
          }
        }

        const activeTurnId =
          event.type === "turn.started"
            ? (event.turnId ?? null)
            : event.type === "thread.state.changed" && event.payload.state === "compacted"
              ? (event.turnId ?? currentActiveTurnId)
              : event.type === "turn.completed" ||
                  event.type === "turn.aborted" ||
                  (event.type === "thread.state.changed" &&
                    (event.payload.state === "archived" ||
                      event.payload.state === "closed" ||
                      event.payload.state === "error")) ||
                  event.type === "session.exited" ||
                  event.type === "runtime.error" ||
                  (event.type === "session.state.changed" &&
                    (event.payload.state === "ready" ||
                      event.payload.state === "stopped" ||
                      event.payload.state === "error"))
                ? null
                : currentActiveTurnId;
        const lastError = runtimeLastErrorForEvent(event);
        const resumeCursor = yield* refreshResumeCursorFromActiveSession(event, binding);

        yield* directory.upsert({
          threadId: event.threadId,
          provider: binding.provider,
          ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
          ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
          status: runtimeStatusForEvent(event, activeTurnId),
          ...(resumeCursor !== undefined ? { resumeCursor } : {}),
          runtimePayload: {
            activeTurnId,
            lastRuntimeEvent: event.type,
            lastRuntimeEventAt: event.createdAt,
            ...(lastError !== undefined ? { lastError } : {}),
          },
        });
        return true;
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider.session.runtime_binding_update_failed", {
          threadId: event.threadId,
          eventType: event.type,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(false)),
      ),
    );
  };

  const processRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      const boundProvider = boundProvidersByThread.get(event.threadId);
      if (boundProvider !== undefined && boundProvider !== event.provider) {
        yield* Effect.logDebug("provider service ignored stale provider event", {
          threadId: event.threadId,
          eventProvider: event.provider,
          boundProvider,
          eventType: event.type,
        });
        return;
      }
      if (isProviderChildRuntimeEvent(event)) {
        yield* publishRuntimeEvent(event);
        return;
      }
      if (event.type === "turn.started") input.idle.reconcileEvent(event);
      const lifecycleEventApplied = yield* updateSessionBindingFromRuntimeEvent(event);
      if (event.type !== "turn.started" && lifecycleEventApplied) {
        input.idle.reconcileEvent(event);
      }
      yield* publishRuntimeEvent(event);
    });

  return {
    withBindingWriteLock,
    upsertSessionBinding,
    upsertStoppedSessionBinding,
    markPersistedThreadStopped,
    processRuntimeEvent,
  };
}
