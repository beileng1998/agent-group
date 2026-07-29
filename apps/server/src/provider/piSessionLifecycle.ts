import type {
  AgentSessionEvent,
  CreateAgentSessionRuntimeFactory,
  ExtensionUIContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { ProviderAdapterRequestError, type ProviderAdapterError } from "./Errors.ts";
import type { PiAdapterShape } from "./Services/PiAdapter.ts";
import {
  DEFAULT_PI_THINKING_LEVEL,
  PROVIDER,
  extractResumeSessionFile,
  getSessionFile,
  makeSessionSnapshot,
  normalizePiThinkingLevel,
  normalizeTokenUsage,
  type PiCodingAgentModule,
  type PiSessionContext,
  toMessage,
  trimToUndefined,
} from "./piAdapterCore.ts";
import { extensionDisplayName, makeAgentDir } from "./piExtensionUi.ts";
import { resolveFreshPiModel } from "./piModelRuntime.ts";

export interface PiSessionLifecycleDependencies {
  readonly defaultCwd: string;
  readonly sessions: Map<ThreadId, PiSessionContext>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<PiSessionContext, ProviderAdapterError>;
  readonly loadPiSdk: (
    method: string,
  ) => Effect.Effect<PiCodingAgentModule, ProviderAdapterRequestError>;
  readonly disposeSessionContext: (context: PiSessionContext) => Promise<void>;
  readonly handleSessionEvent: (context: PiSessionContext, event: AgentSessionEvent) => void;
  readonly makePiExtensionUIContext: (context: PiSessionContext) => ExtensionUIContext;
  readonly makeEventBase: (
    context: PiSessionContext,
    options?: { readonly includeTurnId?: boolean },
  ) => {
    readonly eventId: EventId;
    readonly provider: typeof PROVIDER;
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly turnId?: TurnId;
  };
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => void;
}

export function makePiSessionLifecycle(dependencies: PiSessionLifecycleDependencies) {
  const {
    defaultCwd,
    disposeSessionContext,
    handleSessionEvent,
    loadPiSdk,
    makeEventBase,
    makePiExtensionUIContext,
    offerRuntimeEvent,
    requireSession,
    sessions,
  } = dependencies;
  const serverConfig = { cwd: defaultCwd };
  const createSdkRuntime = async (input: {
    sdk: PiCodingAgentModule;
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
  }) => {
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      agentDir,
      sessionManager,
      sessionStartEvent,
    }) => {
      const services = await input.sdk.createAgentSessionServices({
        cwd,
        agentDir,
      });
      const model = await resolveFreshPiModel(services.modelRuntime, input.modelId);
      if (input.modelId && !model) {
        throw new Error(
          `Pi model '${input.modelId}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
        );
      }
      return {
        ...(await input.sdk.createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent ? { sessionStartEvent } : {}),
          ...(model ? { model } : {}),
          thinkingLevel: input.thinkingLevel ?? DEFAULT_PI_THINKING_LEVEL,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };
    const runtime = await input.sdk.createAgentSessionRuntime(createRuntime, {
      cwd: input.sessionManager.getCwd(),
      agentDir: input.agentDir,
      sessionManager: input.sessionManager,
    });
    return runtime;
  };

  const startSession: PiAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      const cwd = trimToUndefined(input.cwd) ?? serverConfig.cwd;
      const piSdk = yield* loadPiSdk("session/start");
      const agentDir = makeAgentDir(input.providerOptions?.pi?.agentDir, piSdk);
      const sessionFile = extractResumeSessionFile(input.resumeCursor);
      const sessionManager = sessionFile
        ? piSdk.SessionManager.open(sessionFile, undefined, cwd)
        : piSdk.SessionManager.create(cwd);
      const modelId =
        input.modelSelection?.provider === "pi" ? input.modelSelection.model : undefined;
      const thinkingLevel =
        input.modelSelection?.provider === "pi"
          ? normalizePiThinkingLevel(input.modelSelection.options?.thinkingLevel)
          : undefined;
      const existingContext = sessions.get(input.threadId);
      if (existingContext) {
        sessions.delete(input.threadId);
        yield* Effect.tryPromise({
          try: () => disposeSessionContext(existingContext),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/restart",
              detail: toMessage(cause, "Failed to dispose previous Pi session."),
              cause,
            }),
        });
      }
      const runtime = yield* Effect.tryPromise({
        try: () =>
          createSdkRuntime({
            sdk: piSdk,
            cwd,
            agentDir,
            sessionManager,
            ...(modelId ? { modelId } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/start",
            detail: toMessage(cause, "Failed to start Pi session."),
            cause,
          }),
      });
      const now = new Date().toISOString();
      const model = runtime.session.model
        ? `${runtime.session.model.provider}/${runtime.session.model.id}`
        : modelId;
      const resumeCursor = getSessionFile(runtime.session);
      const session: ProviderSession = {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
        ...(model ? { model } : {}),
        ...(resumeCursor ? { resumeCursor } : {}),
      };
      const context: PiSessionContext = {
        runtime,
        session,
        turns: [],
        activeTurnId: undefined,
        activeAssistantItemId: undefined,
        activeReasoningItemId: undefined,
        activeToolItems: new Map(),
        pendingUserInputs: new Map(),
        stopped: false,
        lastKnownTokenUsage: undefined,
        unsubscribe: undefined,
      };
      context.unsubscribe = runtime.session.subscribe((event) =>
        handleSessionEvent(context, event),
      );
      sessions.set(input.threadId, context);
      yield* Effect.tryPromise({
        try: () => runtime.session.bindExtensions({ uiContext: makePiExtensionUIContext(context) }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension/bind",
            detail: toMessage(cause, "Failed to bind Pi extensions."),
            cause,
          }),
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            sessions.delete(input.threadId);
            yield* Effect.tryPromise({
              try: () => disposeSessionContext(context),
              catch: () => error,
            }).pipe(Effect.catch(() => Effect.void));
            return yield* Effect.fail(error);
          }),
        ),
      );
      const loadedExtensions = runtime.session.resourceLoader.getExtensions().extensions;
      if (loadedExtensions.length > 0) {
        const extensionNames = loadedExtensions.map(extensionDisplayName);
        offerRuntimeEvent({
          ...makeEventBase(context, { includeTurnId: false }),
          type: "runtime.warning",
          payload: {
            message:
              "Pi extensions are loaded with Agent Group's limited UI bridge. select/confirm/input/notify/status are supported; TUI-only widgets and editor hooks are ignored.",
            detail: {
              extensionCount: loadedExtensions.length,
              extensions: extensionNames,
            },
          },
          raw: {
            source: "pi.sdk.event",
            method: "extension/ui-limited-warning",
            payload: { extensionCount: loadedExtensions.length, extensions: extensionNames },
          },
        } satisfies ProviderRuntimeEvent);
      }
      offerRuntimeEvent({
        ...makeEventBase(context),
        type: "session.started",
        payload: { message: "Pi session started", resume: session.resumeCursor },
      } satisfies ProviderRuntimeEvent);
      offerRuntimeEvent({
        ...makeEventBase(context),
        type: "thread.started",
        payload: { providerThreadId: runtime.session.sessionId },
      } satisfies ProviderRuntimeEvent);
      const initialUsage = normalizeTokenUsage(
        runtime.session.getSessionStats(),
        runtime.session.model?.contextWindow,
      );
      context.lastKnownTokenUsage = initialUsage;
      if (initialUsage) {
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "thread.token-usage.updated",
          payload: { usage: initialUsage },
        } satisfies ProviderRuntimeEvent);
      }
      return session;
    });

  const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.tryPromise({
          try: () => disposeSessionContext(context),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/stop",
              detail: toMessage(cause, "Failed to stop Pi session."),
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              context.stopped = true;
              sessions.delete(threadId);
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "thread.state.changed",
                payload: { state: "closed", detail: { reason: "stopped" } },
              } satisfies ProviderRuntimeEvent);
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "session.exited",
                payload: { reason: "stopped", exitKind: "graceful" },
              } satisfies ProviderRuntimeEvent);
            }),
          ),
        ),
      ),
      Effect.asVoid,
    );

  const listSessions: PiAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values()).map(makeSessionSnapshot));

  const resolveTranscriptPath: NonNullable<PiAdapterShape["resolveTranscriptPath"]> = (input) =>
    Effect.succeed(extractResumeSessionFile(input.resumeCursor) ?? null);

  const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => sessions.has(threadId));

  const stopAll: PiAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
      concurrency: "unbounded",
      discard: true,
    }).pipe(Effect.asVoid);

  return {
    hasSession,
    listSessions,
    resolveTranscriptPath,
    startSession,
    stopAll,
    stopSession,
  };
}
