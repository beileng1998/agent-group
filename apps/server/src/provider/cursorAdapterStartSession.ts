import {
  ApprovalRequestId,
  type EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@agent-group/contracts";
import { Effect, Exit, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfigShape } from "../config.ts";
import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import { makeAcpNativeLoggers } from "./acp/AcpNativeLogging.ts";
import {
  makeCursorAcpRuntime,
  type CursorAcpRuntimeCursorSettings,
} from "./acp/CursorAcpSupport.ts";
import { forkCursorEventConsumer } from "./cursorAdapterEventConsumer.ts";
import { registerCursorProtocolHandlers } from "./cursorAdapterProtocol.ts";
import {
  CURSOR_RESUME_VERSION,
  applyRequestedCursorSessionConfiguration,
  parseCursorResume,
  resolveCursorSessionCwd,
  type CursorSessionContext,
  type PendingApproval,
  type PendingUserInput,
} from "./cursorAdapterSessionState.ts";
import { ProviderAdapterProcessError, ProviderAdapterValidationError } from "./Errors.ts";
import type { CursorAdapterShape } from "./Services/CursorAdapter.ts";
import type { EventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";

const PROVIDER = "cursor" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type CursorNativeSource = "acp.jsonrpc" | "acp.cursor.extension";

export function makeCursorStartSession(input: {
  readonly cursorSettings: CursorAcpRuntimeCursorSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverConfig: ServerConfigShape;
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly sessions: Map<ThreadId, CursorSessionContext>;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly withThreadLock: <A, E, R>(
    threadId: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly stopSessionInternal: (ctx: CursorSessionContext) => Effect.Effect<void>;
  readonly logNative: (
    threadId: ThreadId,
    method: string,
    payload: unknown,
    source: CursorNativeSource,
  ) => Effect.Effect<void>;
  readonly completePlanTurn: (
    ctx: CursorSessionContext,
    turnId: NonNullable<CursorSessionContext["activeTurnId"]>,
    activePromptFiber: CursorSessionContext["activePromptFiber"],
  ) => Effect.Effect<void>;
  readonly emitPlanUpdate: (
    ctx: CursorSessionContext,
    payload: {
      readonly explanation?: string | null;
      readonly plan: ReadonlyArray<{
        readonly step: string;
        readonly status: "pending" | "inProgress" | "completed";
      }>;
    },
    rawPayload: unknown,
    source: CursorNativeSource,
    method: string,
  ) => Effect.Effect<void>;
}): CursorAdapterShape["startSession"] {
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
        const cwd = resolveCursorSessionCwd(request.cwd, input.serverConfig);
        if (cwd === undefined) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const cursorModelSelection =
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
        let ctx!: CursorSessionContext;
        const resumeSessionId = parseCursorResume(request.resumeCursor)?.sessionId;
        const acpNativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger: input.nativeEventLogger,
          provider: PROVIDER,
          threadId: request.threadId,
        });
        const providerCursorOptions = request.providerOptions?.cursor;
        const effectiveCursorSettings: CursorAcpRuntimeCursorSettings = {
          ...(input.cursorSettings.binaryPath !== undefined
            ? { binaryPath: input.cursorSettings.binaryPath }
            : {}),
          ...(input.cursorSettings.apiEndpoint !== undefined
            ? { apiEndpoint: input.cursorSettings.apiEndpoint }
            : {}),
          ...(providerCursorOptions?.binaryPath !== undefined
            ? { binaryPath: providerCursorOptions.binaryPath }
            : {}),
          ...(providerCursorOptions?.apiEndpoint !== undefined
            ? { apiEndpoint: providerCursorOptions.apiEndpoint }
            : {}),
        };
        const acp = yield* makeCursorAcpRuntime({
          cursorSettings: effectiveCursorSettings,
          childProcessSpawner: input.childProcessSpawner,
          cwd,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          clientInfo: { name: "Agent Group", version: "0.0.0" },
          ...acpNativeLoggers,
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: request.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );
        yield* registerCursorProtocolHandlers({
          acp,
          threadId: request.threadId,
          runtimeMode: request.runtimeMode,
          pendingApprovals,
          pendingUserInputs,
          getContext: () => ctx,
          makeEventStamp: input.makeEventStamp,
          offerRuntimeEvent: input.offerRuntimeEvent,
          logNative: input.logNative,
          completePlanTurn: input.completePlanTurn,
          emitPlanUpdate: input.emitPlanUpdate,
        });
        const started = yield* acp
          .start()
          .pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, request.threadId, "session/start", error),
            ),
          );
        yield* applyRequestedCursorSessionConfiguration({
          runtime: acp,
          runtimeMode: request.runtimeMode,
          interactionMode: undefined,
          modelSelection: cursorModelSelection,
          mapError: ({ cause, method }) =>
            mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
        });
        const now = yield* input.nowIso;
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: request.runtimeMode,
          cwd,
          model: cursorModelSelection?.model,
          threadId: request.threadId,
          resumeCursor: { schemaVersion: CURSOR_RESUME_VERSION, sessionId: started.sessionId },
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
          assistantItemTurnIds: new Map(),
          lastPlanFingerprint: undefined,
          completedPlanFingerprint: undefined,
          activeInteractionMode: undefined,
          activeTurnId: undefined,
          activeTurnFailedToolDetail: undefined,
          activePromptFiber: undefined,
          lastTurnActivityAt: undefined,
          latestSessionCostUsd: undefined,
          stopped: false,
        };
        ctx.notificationFiber = yield* forkCursorEventConsumer({
          ctx,
          makeEventStamp: input.makeEventStamp,
          offerRuntimeEvent: input.offerRuntimeEvent,
          logNative: input.logNative,
          emitPlanUpdate: input.emitPlanUpdate,
        });
        input.sessions.set(request.threadId, ctx);
        sessionScopeTransferred = true;
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
          payload: { state: "ready", reason: "Cursor ACP session ready" },
        });
        yield* input.offerRuntimeEvent({
          type: "thread.started",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: request.threadId,
          payload: { providerThreadId: started.sessionId },
        });
        return session;
      }).pipe(Effect.scoped),
    );
}
