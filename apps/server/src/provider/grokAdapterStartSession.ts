import {
  ApprovalRequestId,
  type EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@agent-group/contracts";
import { Deferred, Effect, Exit, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfigShape } from "../config.ts";
import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import type { AcpThreadLock } from "./acp/AcpAdapterSessionSupport.ts";
import { makeAcpNativeLoggers } from "./acp/AcpNativeLogging.ts";
import { makeGrokAcpRuntime, type GrokAcpRuntimeSettings } from "./acp/GrokAcpSupport.ts";
import { settleGrokResumeReplayWhenQuiet } from "./grokAdapterCoordination.ts";
import type { makeGrokEventConsumer } from "./grokAdapterEventConsumer.ts";
import {
  GROK_ACP_DEBUG_ENV,
  GROK_ACP_TRANSPORT_DEBUG_MARKER,
  makeGrokAcpRuntimeLoggers,
} from "./grokAdapterLogging.ts";
import { registerGrokProtocolHandlers } from "./grokAdapterProtocol.ts";
import {
  GROK_RESUME_VERSION,
  applyRequestedGrokSessionConfiguration,
  type GrokSessionContext,
  parseGrokResume,
  type PendingApproval,
  type PendingUserInput,
  resolveGrokSessionCwd,
} from "./grokAdapterSessionState.ts";
import { ProviderAdapterValidationError } from "./Errors.ts";
import type { EventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";
import type { GrokAdapterShape } from "./Services/GrokAdapter.ts";

const PROVIDER = "grok" as const;
const GROK_RESUME_REPLAY_MAX_WAIT_MS = 1_500;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type GrokEventConsumer = ReturnType<typeof makeGrokEventConsumer>;

export function makeGrokStartSession(input: {
  readonly grokSettings: GrokAcpRuntimeSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverConfig: ServerConfigShape;
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly sessions: Map<ThreadId, GrokSessionContext>;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly withThreadLock: AcpThreadLock;
  readonly stopSessionInternal: (ctx: GrokSessionContext) => Effect.Effect<void>;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
  readonly consumeGrokEvent: GrokEventConsumer;
}): GrokAdapterShape["startSession"] {
  return (request) =>
    input.withThreadLock(
      request.threadId,
      Effect.gen(function* () {
        if (request.provider !== undefined && request.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${request.provider}'.`,
          });
        }
        const cwd = resolveGrokSessionCwd(request.cwd, input.serverConfig);
        if (cwd === undefined) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const grokModelSelection =
          request.modelSelection?.provider === PROVIDER ? request.modelSelection : undefined;
        const existing = input.sessions.get(request.threadId);
        if (existing && !existing.stopped) yield* input.stopSessionInternal(existing);

        const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
        const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
        const sessionScope = yield* Scope.make("sequential");
        let sessionScopeTransferred = false;
        yield* Effect.addFinalizer(() =>
          sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        let ctx: GrokSessionContext | undefined;
        const resumeSessionId = parseGrokResume(request.resumeCursor)?.sessionId;
        const nativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger: input.nativeEventLogger,
          provider: PROVIDER,
          threadId: request.threadId,
        });
        const providerOptions = request.providerOptions?.grok;
        const settings: GrokAcpRuntimeSettings = {
          ...(input.grokSettings.binaryPath !== undefined
            ? { binaryPath: input.grokSettings.binaryPath }
            : {}),
          ...(providerOptions?.binaryPath !== undefined
            ? { binaryPath: providerOptions.binaryPath }
            : {}),
          ...(grokModelSelection?.model ? { model: grokModelSelection.model } : {}),
          ...(grokModelSelection?.options?.reasoningEffort
            ? { reasoningEffort: grokModelSelection.options.reasoningEffort }
            : {}),
          ...(request.runtimeMode === "full-access" ? { alwaysApprove: true } : {}),
        };
        yield* Effect.logInfo("grok.acp.start", {
          marker: GROK_ACP_TRANSPORT_DEBUG_MARKER,
          debugEnv: GROK_ACP_DEBUG_ENV,
          threadId: request.threadId,
          cwd,
          resume: resumeSessionId !== undefined,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          alwaysApprove: settings.alwaysApprove === true,
          binaryPath: settings.binaryPath ?? "grok",
        });
        const acp = yield* makeGrokAcpRuntime({
          grokSettings: settings,
          childProcessSpawner: input.childProcessSpawner,
          cwd,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          clientInfo: { name: "Agent Group", version: "0.0.0" },
          ...makeGrokAcpRuntimeLoggers(nativeLoggers),
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError((cause) =>
            mapAcpToAdapterError(PROVIDER, request.threadId, "session/start", cause),
          ),
        );
        yield* registerGrokProtocolHandlers({
          acp,
          threadId: request.threadId,
          runtimeMode: request.runtimeMode,
          pendingApprovals,
          getContext: () => ctx,
          makeEventStamp: input.makeEventStamp,
          offerRuntimeEvent: input.offerRuntimeEvent,
          logNative: input.logNative,
        });
        const started = yield* acp
          .start()
          .pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, request.threadId, "session/start", error),
            ),
          );
        const resumeReplayReady =
          resumeSessionId !== undefined ? yield* Deferred.make<void>() : undefined;
        const sessionConfigReady = yield* Deferred.make<void>();
        const now = yield* input.nowIso;
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: request.runtimeMode,
          cwd,
          model: grokModelSelection?.model,
          threadId: request.threadId,
          resumeCursor: { schemaVersion: GROK_RESUME_VERSION, sessionId: started.sessionId },
          createdAt: now,
          updatedAt: now,
        };
        ctx = {
          threadId: request.threadId,
          session,
          scope: sessionScope,
          acp,
          notificationFiber: undefined,
          pendingApprovals,
          pendingUserInputs,
          turns: [],
          lastPlanFingerprint: undefined,
          activeInteractionMode: undefined,
          activeTurnId: undefined,
          activeTurnHadAssistantContent: false,
          activeAssistantItemsWithContent: new Set(),
          activeTurnFailedToolDetail: undefined,
          activePromptFiber: undefined,
          lastTurnActivityAt: undefined,
          turnToolCallIds: new Map(),
          sessionUpdatesProcessed: 0,
          sessionConfigReady,
          resumeReplayReady,
          resumeReplayLastSuppressedAt: resumeReplayReady !== undefined ? Date.now() : undefined,
          turnStarting: false,
          pendingTurnInterrupted: false,
          compactingThread: false,
          compactionFailedToolDetail: undefined,
          compactionQuietUntil: undefined,
          compactionCancelFiber: undefined,
          latestSessionCostUsd: undefined,
          stopped: false,
        };
        const activeContext = ctx;
        activeContext.notificationFiber = yield* Stream.runDrain(
          Stream.mapEffect(acp.getEvents(), (event) =>
            input.consumeGrokEvent(activeContext, event),
          ),
        ).pipe(Effect.forkChild);
        input.sessions.set(request.threadId, activeContext);
        sessionScopeTransferred = true;

        yield* Effect.gen(function* () {
          yield* applyRequestedGrokSessionConfiguration({
            runtime: acp,
            runtimeMode: request.runtimeMode,
            interactionMode: undefined,
            modelSelection: grokModelSelection,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
          });
          yield* Deferred.succeed(sessionConfigReady, undefined);
          activeContext.sessionConfigReady = undefined;
          if (resumeReplayReady !== undefined) {
            yield* settleGrokResumeReplayWhenQuiet(activeContext).pipe(
              Effect.forkIn(activeContext.scope),
            );
            yield* Deferred.await(resumeReplayReady).pipe(
              Effect.timeoutOption(GROK_RESUME_REPLAY_MAX_WAIT_MS),
            );
          }
          yield* input.offerRuntimeEvent({
            type: "session.started",
            ...(yield* input.makeEventStamp()),
            provider: PROVIDER,
            threadId: request.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* input.offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* input.makeEventStamp()),
            provider: PROVIDER,
            threadId: request.threadId,
            payload: { state: "ready", reason: "Grok ACP session ready" },
          });
          yield* input.offerRuntimeEvent({
            type: "thread.started",
            ...(yield* input.makeEventStamp()),
            provider: PROVIDER,
            threadId: request.threadId,
            payload: { providerThreadId: started.sessionId },
          });
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.ignore(input.stopSessionInternal(activeContext)),
          ),
        );
        return session;
      }).pipe(Effect.scoped),
    );
}
