/**
 * DroidAdapterLive - Factory Droid CLI (`droid exec --output-format acp`) via ACP.
 *
 * @module DroidAdapterLive
 */
import { EventId, type ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import {
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  PubSub,
  Random,
  Semaphore,
  Scope,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import {
  makeAcpThreadLock,
  settleAcpPendingApprovalsAsCancelled,
  settleAcpPendingUserInputsAsEmptyAnswers,
} from "../acp/AcpAdapterSessionSupport.ts";
import type { DroidAcpRuntimeSettings } from "../acp/DroidAcpSupport.ts";
import { makeDroidSessionTeardownGate } from "../acp/DroidSessionTeardownGate.ts";
import { makeDroidDiscovery } from "../droidAdapterDiscovery.ts";
import { makeDroidEventConsumer } from "../droidAdapterEventConsumer.ts";
import type { DroidSessionContext } from "../droidAdapterSessionState.ts";
import { makeDroidStartSession } from "../droidAdapterStartSession.ts";
import { makeDroidThreadOperations } from "../droidAdapterThreadOperations.ts";
import { makeDroidTurnOperations } from "../droidAdapterTurns.ts";
import { DroidAdapter, type DroidAdapterShape } from "../Services/DroidAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

export {
  isDroidNestedTaskToolCall,
  isRenderableDroidAssistantDelta,
  resolveDroidPermissionPolicy,
  resolveDroidSessionCwd,
  scopeDroidRuntimeItemIdForTurn,
  scopeDroidToolCallStateForTurn,
  shouldIgnoreDroidInterrupt,
} from "../droidAdapterSessionState.ts";

const PROVIDER = "droid" as const;

export interface DroidAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

export function makeDroidAdapter(
  droidSettings: DroidAcpRuntimeSettings,
  options?: DroidAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

    const sessions = new Map<ThreadId, DroidSessionContext>();
    const sessionTeardownGate = makeDroidSessionTeardownGate();
    const withThreadLock = yield* makeAcpThreadLock();
    const discoveryLock = yield* Semaphore.make(1);
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    // Discovery sessions are disposable and never enter the live session directory.
    const logNative = (threadId: ThreadId, method: string, payload: unknown) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = new Date().toISOString();
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: crypto.randomUUID(),
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method,
              threadId,
              payload,
            },
          },
          threadId,
        );
      });
    const consumeDroidEvent = makeDroidEventConsumer({
      makeEventStamp,
      offerRuntimeEvent,
      logNative,
    });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<DroidSessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (
      ctx: DroidSessionContext,
      options?: {
        readonly exitKind?: "graceful" | "error";
        readonly reason?: string;
        readonly awaitTermination?: boolean;
      },
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!ctx.stopped) {
            ctx.stopped = true;
            sessionTeardownGate.track(ctx.threadId, ctx.teardownComplete);
            sessions.delete(ctx.threadId);
            yield* settleAcpPendingApprovalsAsCancelled(ctx.pendingApprovals);
            yield* settleAcpPendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
            if (ctx.sessionConfigReady !== undefined) {
              yield* Deferred.succeed(ctx.sessionConfigReady, undefined);
              ctx.sessionConfigReady = undefined;
            }
            if (ctx.resumeReplayReady !== undefined) {
              yield* Deferred.succeed(ctx.resumeReplayReady, undefined);
              ctx.resumeReplayReady = undefined;
              ctx.resumeReplayLastSuppressedAt = undefined;
            }
            if (ctx.notificationFiber) {
              yield* Fiber.interrupt(ctx.notificationFiber);
            }

            const completeTeardown = sessionTeardownGate.complete(
              ctx.threadId,
              ctx.teardownComplete,
            );
            const teardown = Effect.gen(function* () {
              yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
              yield* offerRuntimeEvent({
                type: "session.exited",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: ctx.threadId,
                payload: {
                  exitKind: options?.exitKind ?? "graceful",
                  ...(options?.reason ? { reason: options.reason } : {}),
                },
              });
            }).pipe(Effect.ensuring(completeTeardown));

            // Scope.close interrupts prompt/watchdog fibers owned by this scope.
            // A daemon performs the close so those fibers can initiate teardown
            // without waiting on their own termination.
            yield* teardown.pipe(Effect.forkDetach, Effect.asVoid);
          }

          if (options?.awaitTermination !== false) {
            yield* restore(Deferred.await(ctx.teardownComplete));
          }
        }),
      );

    const startSession = makeDroidStartSession({
      droidSettings,
      childProcessSpawner,
      serverConfig,
      nativeEventLogger,
      sessions,
      sessionTeardownGate,
      nowIso,
      makeEventStamp,
      offerRuntimeEvent,
      withThreadLock,
      stopSessionInternal,
      logNative,
      consumeDroidEvent,
    });

    const { sendTurn, interruptTurn } = makeDroidTurnOperations({
      fileSystem,
      attachmentsDir: serverConfig.attachmentsDir,
      nowIso,
      makeEventStamp,
      offerRuntimeEvent,
      requireSession,
      stopSessionInternal,
    });

    const {
      respondToRequest,
      respondToUserInput,
      readThread,
      readExternalThread,
      rollbackThread,
      forkThread,
      stopSession,
      listSessions,
      resolveTranscriptPath,
      hasSession,
      getComposerCapabilities,
    } = makeDroidThreadOperations({
      droidSettings,
      childProcessSpawner,
      serverConfig,
      sessions,
      sessionTeardownGate,
      withThreadLock,
      startSession,
      stopSessionInternal,
    });

    const { listModels, listCommands, listPlugins, readPlugin } = makeDroidDiscovery({
      droidSettings,
      childProcessSpawner,
      serverConfig,
      sessions,
      discoveryLock,
    });

    const stopAll: DroidAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), (ctx) => stopSessionInternal(ctx), {
        discard: true,
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(Array.from(sessions.values()), (ctx) => stopSessionInternal(ctx), {
        discard: true,
      }).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "restart-session",
        conversationRollback: "restart-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      readExternalThread,
      resolveTranscriptPath,
      rollbackThread,
      forkThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      getComposerCapabilities,
      listCommands,
      listModels,
      listPlugins,
      readPlugin,
      hasSession,
      stopAll,
      streamEvents,
    } satisfies DroidAdapterShape;
  });
}

export const DroidAdapterLive = Layer.effect(DroidAdapter, makeDroidAdapter({}));

export function makeDroidAdapterLive(
  droidSettings: DroidAcpRuntimeSettings = {},
  options?: DroidAdapterLiveOptions,
) {
  return Layer.effect(DroidAdapter, makeDroidAdapter(droidSettings, options));
}
