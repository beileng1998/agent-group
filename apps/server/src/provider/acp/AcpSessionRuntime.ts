// FILE: AcpSessionRuntime.ts
// Purpose: Owns one authenticated ACP process, session setup, configuration, and event stream.
// Layer: Provider ACP runtime
// Exports: AcpSessionRuntime and its typed runtime factory contracts.

import { randomUUID } from "node:crypto";
import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";
import { Deferred, Effect, Exit, Layer, Queue, Ref, Scope, ServiceMap, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpClient from "effect-acp/client";
import * as EffectAcpErrors from "effect-acp/errors";
import * as EffectAcpSchema from "effect-acp/schema";

import {
  extractModelConfigId,
  parseSessionModeState,
  type AcpParsedSessionEvent,
  type AcpSessionModeState,
  type AcpToolCallState,
} from "./AcpRuntimeModel.ts";
import { makeAcpLoggedRequest } from "./AcpRequestLogging.ts";
import {
  makeAcpSessionConfigController,
  sessionConfigOptionsFromSetup,
} from "./AcpSessionConfiguration.ts";
import {
  closeActiveAssistantSegment,
  handleSessionUpdate,
  type AcpAssistantSegmentState,
} from "./AcpSessionEventState.ts";
import type {
  AcpSessionRuntimeOptions,
  AcpSessionRuntimeShape,
  AcpSessionRuntimeStartResult,
  AcpStartedState,
  AcpStartState,
} from "./AcpSessionRuntimeContracts.ts";

export { assistantItemId } from "./AcpSessionEventState.ts";
export {
  decodeSetSessionConfigOptionResponse,
  sessionConfigOptionsFromSetup,
} from "./AcpSessionConfiguration.ts";
export type {
  AcpSessionRequestLogEvent,
  AcpSessionRuntimeOptions,
  AcpSessionRuntimeShape,
  AcpSessionRuntimeStartResult,
  AcpSpawnInput,
} from "./AcpSessionRuntimeContracts.ts";

export class AcpSessionRuntime extends ServiceMap.Service<
  AcpSessionRuntime,
  AcpSessionRuntimeShape
>()("agent-group/provider/acp/AcpSessionRuntime") {
  static layer(
    options: AcpSessionRuntimeOptions,
  ): Layer.Layer<
    AcpSessionRuntime,
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    return Layer.effect(AcpSessionRuntime, makeAcpSessionRuntime(options));
  }
}

const makeAcpSessionRuntime = (
  options: AcpSessionRuntimeOptions,
): Effect.Effect<
  AcpSessionRuntimeShape,
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Scope.Scope;
    const eventQueue = yield* Queue.unbounded<AcpParsedSessionEvent>();
    const modeStateRef = yield* Ref.make<AcpSessionModeState | undefined>(undefined);
    const availableCommandsRef = yield* Ref.make<ReadonlyArray<EffectAcpSchema.AvailableCommand>>(
      [],
    );
    const toolCallsRef = yield* Ref.make(new Map<string, AcpToolCallState>());
    const assistantSegmentRef = yield* Ref.make<AcpAssistantSegmentState>({ nextSegmentIndex: 0 });
    // Unique per runtime instance so assistant message ids never collide across
    // server restarts or session resumes (segment index resets to 0 each time).
    const runtimeInstanceId = randomUUID().slice(0, 8);
    const configOptionsRef = yield* Ref.make(sessionConfigOptionsFromSetup(undefined));
    const startStateRef = yield* Ref.make<AcpStartState>({ _tag: "NotStarted" });
    const getStartedState = Effect.gen(function* () {
      const state = yield* Ref.get(startStateRef);
      if (state._tag === "Started") {
        return state.result;
      }
      return yield* new EffectAcpErrors.AcpTransportError({
        detail: "ACP session runtime has not been started",
        cause: new Error("ACP session runtime has not been started"),
      });
    });
    // session/load can replay a large history before the consumer attaches; drop
    // those notifications so they never accumulate in the unbounded queue. For
    // resumed sessions the gate stays closed past start() and only opens once the
    // adapter attaches a consumer via getEvents(), because the agent may keep
    // replaying after replying to session/load. Plain mutable state (not a Ref)
    // so getEvents() can open the gate synchronously at attach time.
    let acceptingSessionUpdates = false;
    // Counts every parsed event offered into eventQueue (see
    // sessionUpdatesEnqueuedCount on the shape). Plain mutable state: single
    // writer per offer, and readers only need a monotonic snapshot.
    let sessionUpdatesEnqueued = 0;
    const offerSessionEvent = (event: AcpParsedSessionEvent): Effect.Effect<void> =>
      Effect.suspend(() => {
        sessionUpdatesEnqueued += 1;
        return Effect.asVoid(Queue.offer(eventQueue, event));
      });

    const runLoggedRequest = makeAcpLoggedRequest(options.requestLogger);

    const env = options.spawn.env ? { ...process.env, ...options.spawn.env } : process.env;
    const prepared = prepareWindowsSafeProcess(options.spawn.command, options.spawn.args, {
      cwd: options.spawn.cwd,
      env,
    });
    const child = yield* spawner
      .spawn(
        ChildProcess.make(prepared.command, prepared.args, {
          ...(options.spawn.cwd ? { cwd: options.spawn.cwd } : {}),
          env,
          shell: prepared.shell,
          ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpSpawnError({
              command: options.spawn.command,
              cause,
            }),
        ),
      );

    const acpContext = yield* Layer.build(
      EffectAcpClient.layerChildProcess(child, {
        ...(options.protocolLogging?.logIncoming !== undefined
          ? { logIncoming: options.protocolLogging.logIncoming }
          : {}),
        ...(options.protocolLogging?.logOutgoing !== undefined
          ? { logOutgoing: options.protocolLogging.logOutgoing }
          : {}),
        ...(options.protocolLogging?.logger ? { logger: options.protocolLogging.logger } : {}),
      }),
    ).pipe(Effect.provideService(Scope.Scope, runtimeScope));

    const acp = ServiceMap.getUnsafe(acpContext, EffectAcpClient.AcpClient);

    // The protocol layer offers every incoming notification into an unbounded
    // raw queue (acp.raw.notifications) in addition to invoking the
    // handleSessionUpdate callback. Nothing consumes that stream in this
    // runtime, so a resumed session's replay would accumulate there without
    // bound regardless of the accepting gate below — drain it for the
    // runtime's lifetime. (handleSessionUpdate delivery is unaffected: it is
    // driven by the callback path, not this queue.)
    yield* Stream.runDrain(acp.raw.notifications).pipe(Effect.forkIn(runtimeScope));

    const configController = yield* makeAcpSessionConfigController({
      acp,
      configOptionsRef,
      modeStateRef,
      getStartedState,
      runLoggedRequest,
    });

    yield* acp.handleSessionUpdate((notification) =>
      Effect.suspend(() => {
        const update = notification.update;
        const rememberCommands =
          update.sessionUpdate === "available_commands_update"
            ? Ref.set(availableCommandsRef, update.availableCommands)
            : Effect.void;
        const rememberConfigOptions =
          update.sessionUpdate === "config_option_update"
            ? configController.rememberConfigOptions(update.configOptions)
            : Effect.void;
        const rememberBoundedState = rememberCommands.pipe(Effect.andThen(rememberConfigOptions));
        if (!acceptingSessionUpdates) {
          // Command and configuration inventories are bounded state, not
          // transcript replay; retain them even while historical session
          // updates are being suppressed.
          return rememberBoundedState;
        }
        return rememberBoundedState.pipe(
          Effect.andThen(
            handleSessionUpdate({
              offer: offerSessionEvent,
              modeStateRef,
              toolCallsRef,
              assistantSegmentRef,
              runtimeInstanceId,
              params: notification,
            }),
          ),
        );
      }),
    );

    const initializeClientCapabilities = {
      fs: {
        readTextFile: false,
        writeTextFile: false,
        ...options.clientCapabilities?.fs,
      },
      terminal: options.clientCapabilities?.terminal ?? false,
      ...(options.clientCapabilities?.auth ? { auth: options.clientCapabilities.auth } : {}),
      ...(options.clientCapabilities?.elicitation
        ? { elicitation: options.clientCapabilities.elicitation }
        : {}),
      ...(options.clientCapabilities?._meta ? { _meta: options.clientCapabilities._meta } : {}),
    } satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

    const startOnce = Effect.gen(function* () {
      const initializePayload = {
        protocolVersion: 1,
        clientCapabilities: initializeClientCapabilities,
        clientInfo: options.clientInfo,
      } satisfies EffectAcpSchema.InitializeRequest;

      const initializeResult = yield* runLoggedRequest(
        "initialize",
        initializePayload,
        acp.agent.initialize(initializePayload),
      );
      const authMethodId =
        options.resolveAuthMethodId !== undefined
          ? yield* options.resolveAuthMethodId(initializeResult)
          : options.authMethodId;

      if (!authMethodId) {
        return yield* new EffectAcpErrors.AcpRequestError({
          code: -32602,
          errorMessage: "ACP agent did not provide an authentication method.",
          data: { authMethods: initializeResult.authMethods ?? [] },
        });
      }

      const authenticatePayload = {
        methodId: authMethodId,
        ...(options.authenticateMeta ? { _meta: options.authenticateMeta } : {}),
      } satisfies EffectAcpSchema.AuthenticateRequest;

      yield* runLoggedRequest(
        "authenticate",
        authenticatePayload,
        acp.agent.authenticate(authenticatePayload),
      );

      let sessionId: string;
      let sessionSetupResult:
        | EffectAcpSchema.LoadSessionResponse
        | EffectAcpSchema.NewSessionResponse
        | EffectAcpSchema.ResumeSessionResponse;
      let resumedExistingSession = false;
      let sessionSetupMethod: AcpSessionRuntimeStartResult["sessionSetupMethod"] = "new";
      if (options.resumeSessionId) {
        const resumePayload = {
          sessionId: options.resumeSessionId,
          cwd: options.cwd,
          mcpServers: [],
        } satisfies EffectAcpSchema.ResumeSessionRequest;
        const supportsResume =
          initializeResult.agentCapabilities?.sessionCapabilities?.resume != null;
        const supportsLoad = initializeResult.agentCapabilities?.loadSession === true;
        if (!supportsResume && !supportsLoad) {
          return yield* new EffectAcpErrors.AcpRequestError({
            code: -32601,
            errorMessage:
              "ACP agent cannot reopen the requested session because it advertises neither session/resume nor session/load.",
          });
        }
        const resumed = yield* (
          supportsResume
            ? runLoggedRequest(
                "session/resume",
                resumePayload,
                acp.agent.resumeSession(resumePayload),
              )
            : (() => {
                const loadPayload = {
                  sessionId: options.resumeSessionId,
                  cwd: options.cwd,
                  mcpServers: [],
                } satisfies EffectAcpSchema.LoadSessionRequest;
                return runLoggedRequest(
                  "session/load",
                  loadPayload,
                  acp.agent.loadSession(loadPayload),
                );
              })()
        ).pipe(Effect.exit);
        if (Exit.isSuccess(resumed)) {
          // A resumed session may keep replaying history after session/load
          // returns; keep dropping until getEvents() attaches a consumer so
          // the replay cannot pile up in the unbounded queue.
          sessionId = options.resumeSessionId;
          sessionSetupResult = resumed.value;
          resumedExistingSession = true;
          sessionSetupMethod = supportsResume ? "resume" : "load";
        } else {
          // Fresh fallback session: no replay risk, and agents may emit early
          // session/update from inside session/new — accept from here so those
          // buffer for the consumer instead of being dropped.
          acceptingSessionUpdates = true;
          const createPayload = {
            cwd: options.cwd,
            mcpServers: [],
          } satisfies EffectAcpSchema.NewSessionRequest;
          const created = yield* runLoggedRequest(
            "session/new",
            createPayload,
            acp.agent.createSession(createPayload),
          );
          sessionId = created.sessionId;
          sessionSetupResult = created;
          sessionSetupMethod = "new";
        }
      } else {
        // Fresh session: accept updates from before session/new so any early
        // agent output emitted while the request is in flight is buffered.
        acceptingSessionUpdates = true;
        const createPayload = {
          cwd: options.cwd,
          mcpServers: [],
        } satisfies EffectAcpSchema.NewSessionRequest;
        const created = yield* runLoggedRequest(
          "session/new",
          createPayload,
          acp.agent.createSession(createPayload),
        );
        sessionId = created.sessionId;
        sessionSetupResult = created;
        sessionSetupMethod = "new";
      }

      yield* Ref.set(modeStateRef, parseSessionModeState(sessionSetupResult));
      yield* Ref.update(configOptionsRef, (current) =>
        sessionConfigOptionsFromSetup(sessionSetupResult, current),
      );
      // Fresh sessions accept session/update while session/new is in flight, and
      // those events are already in the queue; resetting the merge/segment state
      // they created would orphan their continuations (new segment ids, unmerged
      // tool updates). Only the resumed replay-dropping path starts clean.
      if (resumedExistingSession) {
        yield* Ref.set(toolCallsRef, new Map());
        yield* Ref.set(assistantSegmentRef, { nextSegmentIndex: 0 });
      }

      const nextState = {
        sessionId,
        initializeResult,
        sessionSetupResult,
        modelConfigId: extractModelConfigId(sessionSetupResult),
        sessionSetupMethod,
      } satisfies AcpStartedState;
      return nextState;
    });

    const start = Effect.gen(function* () {
      const deferred = yield* Deferred.make<
        AcpSessionRuntimeStartResult,
        EffectAcpErrors.AcpError
      >();
      const effect = yield* Ref.modify(startStateRef, (state) => {
        switch (state._tag) {
          case "Started":
            return [Effect.succeed(state.result), state] as const;
          case "Starting":
            return [Deferred.await(state.deferred), state] as const;
          case "NotStarted":
            return [
              startOnce.pipe(
                Effect.tap((result) =>
                  Ref.set(startStateRef, { _tag: "Started", result }).pipe(
                    Effect.andThen(Deferred.succeed(deferred, result)),
                  ),
                ),
                Effect.onError((cause) =>
                  Deferred.failCause(deferred, cause).pipe(
                    Effect.andThen(Ref.set(startStateRef, { _tag: "NotStarted" })),
                  ),
                ),
              ),
              { _tag: "Starting", deferred } satisfies AcpStartState,
            ] as const;
        }
      });
      return yield* effect;
    });

    return {
      handleRequestPermission: acp.handleRequestPermission,
      handleElicitation: acp.handleElicitation,
      handleReadTextFile: acp.handleReadTextFile,
      handleWriteTextFile: acp.handleWriteTextFile,
      handleCreateTerminal: acp.handleCreateTerminal,
      handleTerminalOutput: acp.handleTerminalOutput,
      handleTerminalWaitForExit: acp.handleTerminalWaitForExit,
      handleTerminalKill: acp.handleTerminalKill,
      handleTerminalRelease: acp.handleTerminalRelease,
      handleSessionUpdate: acp.handleSessionUpdate,
      handleElicitationComplete: acp.handleElicitationComplete,
      handleUnknownExtRequest: acp.handleUnknownExtRequest,
      handleUnknownExtNotification: acp.handleUnknownExtNotification,
      handleExtRequest: acp.handleExtRequest,
      handleExtNotification: acp.handleExtNotification,
      start: () => start,
      getEvents: () => {
        // Attaching a consumer opens the session/update gate: from here on the
        // queue is drained, so accepting notifications can no longer grow it
        // without bound (see acceptingSessionUpdates above).
        acceptingSessionUpdates = true;
        return Stream.fromQueue(eventQueue);
      },
      sessionUpdatesEnqueuedCount: Effect.sync(() => sessionUpdatesEnqueued),
      getModeState: Ref.get(modeStateRef),
      getConfigOptions: Ref.get(configOptionsRef),
      getAvailableCommands: Ref.get(availableCommandsRef),
      prompt: (payload) =>
        getStartedState.pipe(
          Effect.flatMap((started) => {
            const requestPayload = {
              sessionId: started.sessionId,
              ...payload,
            } satisfies EffectAcpSchema.PromptRequest;
            return closeActiveAssistantSegment({
              offer: offerSessionEvent,
              assistantSegmentRef,
            }).pipe(
              Effect.andThen(
                runLoggedRequest(
                  "session/prompt",
                  requestPayload,
                  acp.agent.prompt(requestPayload),
                ),
              ),
              Effect.tap(() =>
                closeActiveAssistantSegment({
                  offer: offerSessionEvent,
                  assistantSegmentRef,
                }),
              ),
            );
          }),
        ),
      cancel: getStartedState.pipe(
        Effect.flatMap((started) => acp.agent.cancel({ sessionId: started.sessionId })),
      ),
      setMode: configController.setMode,
      setConfigOption: configController.setConfigOption,
      supportsSessionFork: getStartedState.pipe(
        Effect.map(
          (started) =>
            started.initializeResult.agentCapabilities?.sessionCapabilities?.fork != null,
        ),
      ),
      setModel: configController.setModel,
      forkSession: (payload) =>
        getStartedState.pipe(
          Effect.flatMap((started) => {
            const requestPayload = {
              ...payload,
              sessionId: started.sessionId,
            } satisfies EffectAcpSchema.ForkSessionRequest;
            return runLoggedRequest(
              "session/fork",
              requestPayload,
              acp.agent.forkSession(requestPayload),
            );
          }),
        ),
      request: (method, payload) =>
        runLoggedRequest(method, payload, acp.raw.request(method, payload)),
      notify: acp.raw.notify,
    } satisfies AcpSessionRuntimeShape;
  });
