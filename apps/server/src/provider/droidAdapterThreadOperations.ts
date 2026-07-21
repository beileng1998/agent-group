import { type ProviderComposerCapabilities, ThreadId, TurnId } from "@agent-group/contracts";
import { Deferred, Effect, Option } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfigShape } from "../config.ts";
import { findFactorySessionPath, readFactorySessionHistory } from "./FactorySessionHistory.ts";
import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import type { AcpThreadLock } from "./acp/AcpAdapterSessionSupport.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import { makeDroidAcpRuntime, type DroidAcpRuntimeSettings } from "./acp/DroidAcpSupport.ts";
import type { DroidSessionTeardownGate } from "./acp/DroidSessionTeardownGate.ts";
import { DROID_ACP_REQUEST_TIMEOUT_MS, droidAcpTimeoutError } from "./droidAdapterLogging.ts";
import {
  type DroidSessionContext,
  DROID_RESUME_VERSION,
  parseDroidResume,
  resolveDroidSessionCwd,
} from "./droidAdapterSessionState.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import type { DroidAdapterShape } from "./Services/DroidAdapter.ts";

const PROVIDER = "droid" as const;
type StopSessionInternal = (
  ctx: DroidSessionContext,
  options?: {
    readonly exitKind?: "graceful" | "error";
    readonly reason?: string;
    readonly awaitTermination?: boolean;
  },
) => Effect.Effect<void>;

export function makeDroidThreadOperations(input: {
  readonly droidSettings: DroidAcpRuntimeSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverConfig: ServerConfigShape;
  readonly sessions: Map<ThreadId, DroidSessionContext>;
  readonly sessionTeardownGate: DroidSessionTeardownGate;
  readonly withThreadLock: AcpThreadLock;
  readonly startSession: DroidAdapterShape["startSession"];
  readonly stopSessionInternal: StopSessionInternal;
}): Required<
  Pick<
    DroidAdapterShape,
    | "respondToRequest"
    | "respondToUserInput"
    | "readThread"
    | "readExternalThread"
    | "rollbackThread"
    | "forkThread"
    | "stopSession"
    | "listSessions"
    | "resolveTranscriptPath"
    | "hasSession"
    | "getComposerCapabilities"
  >
> {
  const requireSession = (threadId: ThreadId) => {
    const ctx = input.sessions.get(threadId);
    return !ctx || ctx.stopped
      ? Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
      : Effect.succeed(ctx);
  };
  const respondToRequest: DroidAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const pending = ctx.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/request_permission",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }
      yield* Deferred.succeed(pending.decision, decision);
    });
  const respondToUserInput: DroidAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const pending = ctx.pendingUserInputs.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/elicitation",
          detail: `Unknown pending user-input request: ${requestId}`,
        });
      }
      yield* Deferred.succeed(pending.answers, answers);
    });
  const readThread: DroidAdapterShape["readThread"] = (threadId) =>
    Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));
  const readExternalThread: NonNullable<DroidAdapterShape["readExternalThread"]> = (request) =>
    Effect.tryPromise({
      try: () => readFactorySessionHistory(input.serverConfig.homeDir, request.externalThreadId),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/read",
          detail: cause instanceof Error ? cause.message : "Failed to read the Droid session.",
          cause,
        }),
    }).pipe(
      Effect.flatMap((history) =>
        history
          ? Effect.succeed({
              threadId: ThreadId.makeUnsafe(history.sessionId),
              ...(history.cwd ? { cwd: history.cwd } : {}),
              turns: history.messages.map((message, index) => ({
                id: TurnId.makeUnsafe(`factory:${message.id}:${index}`),
                items: [{ type: "factoryMessage", ...message }],
              })),
            })
          : Effect.fail(
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "thread/read",
                detail: `Droid session '${request.externalThreadId}' was not found locally.`,
              }),
            ),
      ),
    );
  const rollbackThread: DroidAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "rollbackThread",
        issue:
          "Droid does not expose a native rewind cursor; rollback must restart the session with retained transcript context.",
      });
    });

  const forkThread: NonNullable<DroidAdapterShape["forkThread"]> = (request) =>
    Effect.gen(function* () {
      const sourceCwd = resolveDroidSessionCwd(
        request.sourceCwd ?? request.cwd,
        input.serverConfig,
      );
      const targetCwd = resolveDroidSessionCwd(
        request.cwd ?? request.sourceCwd,
        input.serverConfig,
      );
      if (!sourceCwd || !targetCwd) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "forkThread",
          issue: "A source and target cwd are required to fork a Droid session.",
        });
      }
      const forkRuntime = (runtime: AcpSessionRuntimeShape) =>
        Effect.gen(function* () {
          if (!(yield* runtime.supportsSessionFork)) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "forkThread",
              issue:
                "This Droid ACP version does not advertise session/fork; Agent Group will rebuild the fork from its retained transcript.",
            });
          }
          return yield* runtime.forkSession({ cwd: targetCwd, mcpServers: [] });
        }).pipe(
          Effect.timeoutOption(DROID_ACP_REQUEST_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(droidAcpTimeoutError("session/fork")),
              onSome: Effect.succeed,
            }),
          ),
        );
      const activeSource = input.sessions.get(request.sourceThreadId);
      const forked = activeSource
        ? yield* forkRuntime(activeSource.acp)
        : yield* Effect.gen(function* () {
            const sourceSessionId = parseDroidResume(request.sourceResumeCursor)?.sessionId;
            if (!sourceSessionId) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "forkThread",
                issue: "The source Droid session has no resumable native cursor.",
              });
            }
            const runtime = yield* makeDroidAcpRuntime({
              droidSettings: {
                ...(input.droidSettings.binaryPath
                  ? { binaryPath: input.droidSettings.binaryPath }
                  : {}),
                ...(request.providerOptions?.droid?.binaryPath
                  ? { binaryPath: request.providerOptions.droid.binaryPath }
                  : {}),
              },
              childProcessSpawner: input.childProcessSpawner,
              cwd: sourceCwd,
              resumeSessionId: sourceSessionId,
              clientInfo: { name: "Agent Group Fork", version: "0.0.0" },
            });
            yield* runtime.start().pipe(
              Effect.timeoutOption(DROID_ACP_REQUEST_TIMEOUT_MS),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(droidAcpTimeoutError("session/resume")),
                  onSome: Effect.succeed,
                }),
              ),
            );
            return yield* forkRuntime(runtime);
          }).pipe(Effect.scoped);
      const resumeCursor = { schemaVersion: DROID_RESUME_VERSION, sessionId: forked.sessionId };
      yield* input.startSession({
        threadId: request.threadId,
        provider: PROVIDER,
        cwd: targetCwd,
        runtimeMode: request.runtimeMode,
        resumeCursor,
        ...(request.modelSelection ? { modelSelection: request.modelSelection } : {}),
        ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}),
      });
      return { threadId: request.threadId, resumeCursor };
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ProviderAdapterRequestError ||
        cause instanceof ProviderAdapterProcessError ||
        cause instanceof ProviderAdapterSessionClosedError ||
        cause instanceof ProviderAdapterSessionNotFoundError ||
        cause instanceof ProviderAdapterValidationError
          ? cause
          : mapAcpToAdapterError(PROVIDER, request.sourceThreadId, "session/fork", cause),
      ),
    );
  const stopSession: DroidAdapterShape["stopSession"] = (threadId) =>
    input.withThreadLock(
      threadId,
      Effect.gen(function* () {
        const ctx = input.sessions.get(threadId);
        if (ctx !== undefined && !ctx.stopped) {
          yield* input.stopSessionInternal(ctx);
          return;
        }
        if (input.sessionTeardownGate.isPending(threadId)) {
          yield* input.sessionTeardownGate.awaitPending(threadId);
          return;
        }
        return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
      }),
    );
  const listSessions: DroidAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(input.sessions.values(), (ctx) => ({ ...ctx.session })));
  const resolveTranscriptPath: NonNullable<DroidAdapterShape["resolveTranscriptPath"]> = (
    request,
  ) => {
    const sessionId = parseDroidResume(request.resumeCursor)?.sessionId;
    return sessionId
      ? Effect.promise(() => findFactorySessionPath(input.serverConfig.homeDir, sessionId))
      : Effect.succeed(null);
  };
  const hasSession: DroidAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const ctx = input.sessions.get(threadId);
      return ctx !== undefined && !ctx.stopped;
    });
  const getComposerCapabilities: NonNullable<DroidAdapterShape["getComposerCapabilities"]> = () =>
    Effect.succeed({
      provider: PROVIDER,
      supportsSkillMentions: false,
      supportsSkillDiscovery: false,
      supportsNativeSlashCommandDiscovery: true,
      supportsPluginMentions: true,
      supportsPluginDiscovery: true,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: false,
      supportsThreadImport: true,
    } satisfies ProviderComposerCapabilities);
  return {
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
  };
}
