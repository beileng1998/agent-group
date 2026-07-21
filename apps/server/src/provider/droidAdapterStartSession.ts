import {
  ApprovalRequestId,
  type EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@agent-group/contracts";
import { Deferred, Effect, Exit, Option, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfigShape } from "../config.ts";
import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import type { AcpThreadLock } from "./acp/AcpAdapterSessionSupport.ts";
import { makeAcpNativeLoggers } from "./acp/AcpNativeLogging.ts";
import {
  applyDroidAcpModelSelection,
  makeDroidAcpRuntime,
  type DroidAcpRuntimeSettings,
} from "./acp/DroidAcpSupport.ts";
import type { DroidSessionTeardownGate } from "./acp/DroidSessionTeardownGate.ts";
import { settleDroidResumeReplayWhenQuiet } from "./droidAdapterCoordination.ts";
import type { makeDroidEventConsumer } from "./droidAdapterEventConsumer.ts";
import {
  DROID_ACP_DEBUG_ENV,
  DROID_ACP_REQUEST_TIMEOUT_MS,
  DROID_ACP_TRANSPORT_DEBUG_MARKER,
  droidAcpTimeoutError,
  makeDroidAcpRuntimeLoggers,
} from "./droidAdapterLogging.ts";
import { registerDroidProtocolHandlers } from "./droidAdapterProtocol.ts";
import {
  type DroidSessionContext,
  DROID_RESUME_VERSION,
  parseDroidResume,
  type PendingApproval,
  type PendingUserInput,
  resolveDroidSessionCwd,
} from "./droidAdapterSessionState.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "./Errors.ts";
import type { EventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";
import type { DroidAdapterShape } from "./Services/DroidAdapter.ts";

const PROVIDER = "droid" as const;
const DROID_RESUME_REPLAY_MAX_WAIT_MS = 3_000;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type DroidEventConsumer = ReturnType<typeof makeDroidEventConsumer>;
type StopSessionInternal = (
  ctx: DroidSessionContext,
  options?: {
    readonly exitKind?: "graceful" | "error";
    readonly reason?: string;
    readonly awaitTermination?: boolean;
  },
) => Effect.Effect<void>;

export function makeDroidStartSession(input: {
  readonly droidSettings: DroidAcpRuntimeSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverConfig: ServerConfigShape;
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly sessions: Map<ThreadId, DroidSessionContext>;
  readonly sessionTeardownGate: DroidSessionTeardownGate;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly withThreadLock: AcpThreadLock;
  readonly stopSessionInternal: StopSessionInternal;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
  readonly consumeDroidEvent: DroidEventConsumer;
}): DroidAdapterShape["startSession"] {
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
        yield* input.sessionTeardownGate.awaitPending(request.threadId);
        const cwd = resolveDroidSessionCwd(request.cwd, input.serverConfig);
        if (cwd === undefined) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const modelSelection =
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
        let ctx: DroidSessionContext | undefined;
        const resumeSessionId = parseDroidResume(request.resumeCursor)?.sessionId;
        const nativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger: input.nativeEventLogger,
          provider: PROVIDER,
          threadId: request.threadId,
        });
        const providerOptions = request.providerOptions?.droid;
        const settings: DroidAcpRuntimeSettings = {
          ...(input.droidSettings.binaryPath !== undefined
            ? { binaryPath: input.droidSettings.binaryPath }
            : {}),
          ...(providerOptions?.binaryPath !== undefined
            ? { binaryPath: providerOptions.binaryPath }
            : {}),
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(modelSelection?.options?.reasoningEffort
            ? { reasoningEffort: modelSelection.options.reasoningEffort }
            : {}),
        };
        yield* Effect.logInfo("droid.acp.start", {
          marker: DROID_ACP_TRANSPORT_DEBUG_MARKER,
          debugEnv: DROID_ACP_DEBUG_ENV,
          threadId: request.threadId,
          cwd,
          resume: resumeSessionId !== undefined,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          skipPermissionsUnsafe: settings.skipPermissionsUnsafe === true,
          binaryPath: settings.binaryPath ?? "droid",
        });
        const acp = yield* makeDroidAcpRuntime({
          droidSettings: settings,
          childProcessSpawner: input.childProcessSpawner,
          cwd,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          clientCapabilities: { elicitation: { form: {} } },
          clientInfo: { name: "Agent Group", version: "0.0.0" },
          ...makeDroidAcpRuntimeLoggers(nativeLoggers),
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError((cause) =>
            mapAcpToAdapterError(PROVIDER, request.threadId, "session/start", cause),
          ),
        );
        yield* registerDroidProtocolHandlers({
          acp,
          threadId: request.threadId,
          runtimeMode: request.runtimeMode,
          pendingApprovals,
          pendingUserInputs,
          getContext: () => ctx,
          makeEventStamp: input.makeEventStamp,
          offerRuntimeEvent: input.offerRuntimeEvent,
          logNative: input.logNative,
        });
        const startedOption = yield* acp.start().pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(PROVIDER, request.threadId, "session/start", cause),
          ),
          Effect.timeoutOption(DROID_ACP_REQUEST_TIMEOUT_MS),
        );
        if (Option.isNone(startedOption)) {
          return yield* droidAcpTimeoutError("session/start");
        }
        const started = startedOption.value;
        if (resumeSessionId !== undefined && started.sessionSetupMethod === "new") {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/resume",
            detail:
              "Droid could not resume the requested native session. Agent Group refused the fresh fallback to avoid silently losing conversation context.",
          });
        }
        const resumeReplayReady =
          started.sessionSetupMethod === "load" ? yield* Deferred.make<void>() : undefined;
        const sessionConfigReady = yield* Deferred.make<void>();
        const teardownComplete = yield* Deferred.make<void>();
        const now = yield* input.nowIso;
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: request.runtimeMode,
          cwd,
          model: modelSelection?.model,
          threadId: request.threadId,
          resumeCursor: { schemaVersion: DROID_RESUME_VERSION, sessionId: started.sessionId },
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
          activeNestedTaskToolCallIds: new Set(),
          nestedTaskLifecycleByToolCallId: new Map(),
          resumeReplayReady,
          resumeReplayLastSuppressedAt: resumeReplayReady !== undefined ? Date.now() : undefined,
          sessionConfigReady,
          teardownComplete,
          latestSessionCostUsd: undefined,
          sessionUpdatesProcessed: 0,
          turnStarting: false,
          pendingTurnInterrupted: false,
          stopped: false,
        };
        const activeContext = ctx;
        activeContext.notificationFiber = yield* Stream.runDrain(
          Stream.mapEffect(acp.getEvents(), (event) =>
            input.consumeDroidEvent(activeContext, event),
          ),
        ).pipe(Effect.forkChild);
        input.sessions.set(request.threadId, activeContext);
        sessionScopeTransferred = true;

        yield* Effect.gen(function* () {
          if (modelSelection?.model) {
            yield* applyDroidAcpModelSelection({
              runtime: acp,
              model: modelSelection.model,
              reasoningEffort: modelSelection.options?.reasoningEffort,
              mapError: ({ cause, method }) =>
                mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
            });
          }
          yield* Deferred.succeed(sessionConfigReady, undefined);
          activeContext.sessionConfigReady = undefined;
          if (resumeReplayReady !== undefined) {
            yield* settleDroidResumeReplayWhenQuiet(activeContext).pipe(
              Effect.forkIn(activeContext.scope),
            );
            yield* Deferred.await(resumeReplayReady).pipe(
              Effect.timeoutOption(DROID_RESUME_REPLAY_MAX_WAIT_MS),
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
            payload: { state: "ready", reason: "Droid ACP session ready" },
          });
          yield* input.offerRuntimeEvent({
            type: "thread.started",
            ...(yield* input.makeEventStamp()),
            provider: PROVIDER,
            threadId: request.threadId,
            payload: { providerThreadId: started.sessionId },
          });
        }).pipe(
          Effect.timeoutOption(DROID_ACP_REQUEST_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(droidAcpTimeoutError("session/set_config_option")),
              onSome: Effect.succeed,
            }),
          ),
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
