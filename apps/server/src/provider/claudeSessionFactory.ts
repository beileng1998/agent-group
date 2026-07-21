import type { Options as ClaudeQueryOptions, SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent, ProviderSession, ThreadId } from "@agent-group/contracts";
import {
  getDefaultModel,
  getEffectiveClaudeCodeEffort,
  getModelCapabilities,
  hasEffortLevel,
  resolveApiModelId,
  trimOrNull,
} from "@agent-group/shared/model";
import { Cause, Effect, Exit, Queue, Random, Ref, Stream } from "effect";

import type {
  ClaudePromptQueueItem,
  ClaudeQueryRuntime,
  ClaudeSessionContext,
  ClaudeToolInFlight,
} from "./claudeAdapterRuntime.ts";
import { toMessage } from "./claudeAdapterErrors.ts";
import { claudeModelDiscoveryKey, type ClaudeQueryFactory } from "./claudeCapabilityDiscovery.ts";
import { makeClaudePermissionBridge } from "./claudePermissionBridge.ts";
import { buildClaudeSdkSubagents } from "./claudePromptInput.ts";
import { readClaudeResumeState, toPermissionMode } from "./claudeAdapterProtocol.ts";
import { ClaudeSubagentRouteRegistry } from "./claudeSubagentRouting.ts";
import type { ClaudeTrackedTask } from "./claudeTaskTracker.ts";
import {
  CLAUDE_ONE_MILLION_CONTEXT_WINDOW_TOKENS,
  resolveClaudeApiModelIdContextWindowMaxTokens,
  resolveSelectedClaudeAutoCompactWindow,
  stripClaudeContextWindowSuffix,
} from "./claudeTokenUsage.ts";
import { ProviderAdapterProcessError, ProviderAdapterValidationError } from "./Errors.ts";
import type { ClaudeAdapterShape } from "./Services/ClaudeAdapter.ts";

const PROVIDER = "claudeAgent" as const;
const SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

export function makeClaudeSessionFactory(input: {
  readonly createQuery: ClaudeQueryFactory;
  readonly defaultCwd: string;
  readonly emitProposedPlanCompleted: Parameters<
    typeof makeClaudePermissionBridge
  >[0]["emitProposedPlanCompleted"];
  readonly emitRuntimeWarning: (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ) => Effect.Effect<void>;
  readonly getSession: (threadId: ThreadId) => ClaudeSessionContext | undefined;
  readonly handleStreamExit: (
    context: ClaudeSessionContext,
    exit: Exit.Exit<void, Error>,
  ) => Effect.Effect<void>;
  readonly installSession: (threadId: ThreadId, context: ClaudeSessionContext) => void;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly prefetchCapabilities: (modelDiscoveryKey: string, query: ClaudeQueryRuntime) => void;
  readonly resolveSdkEnv: Effect.Effect<NodeJS.ProcessEnv>;
  readonly runSdkStream: (context: ClaudeSessionContext) => Effect.Effect<void, Error>;
  readonly stopSessionInternal: (
    context: ClaudeSessionContext,
    options?: { readonly emitExitEvent?: boolean },
  ) => Effect.Effect<void>;
  readonly withLifecycleLock: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}): ClaudeAdapterShape["startSession"] {
  return (sessionInput) =>
    Effect.gen(function* () {
      if (sessionInput.provider !== undefined && sessionInput.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${sessionInput.provider}'.`,
        });
      }

      const startedAt = yield* input.nowIso;
      const resumeState = readClaudeResumeState(sessionInput.resumeCursor);
      const threadId = sessionInput.threadId;
      const existingResumeSessionId = resumeState?.resume;
      const newSessionId =
        existingResumeSessionId === undefined ? yield* Random.nextUUIDv4 : undefined;
      const sessionId = existingResumeSessionId ?? newSessionId;

      const promptQueue = yield* Queue.unbounded<ClaudePromptQueueItem>();
      const prompt = Stream.fromQueue(promptQueue).pipe(
        Stream.filter((item) => item.type === "message"),
        Stream.map((item) => item.message),
        Stream.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause),
        ),
        Stream.toAsyncIterable,
      );

      const inFlightTools = new Map<number, ClaudeToolInFlight>();
      const trackedTasks = new Map<string, ClaudeTrackedTask>(
        (resumeState?.trackedTasks ?? []).map((task) => [task.id, task]),
      );
      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);
      const { canUseTool, pendingApprovals, pendingUserInputs } = makeClaudePermissionBridge({
        contextRef,
        runtimeMode: sessionInput.runtimeMode,
        makeEventStamp: input.makeEventStamp,
        offerRuntimeEvent: input.offerRuntimeEvent,
        emitProposedPlanCompleted: input.emitProposedPlanCompleted,
      });

      const providerOptions = sessionInput.providerOptions?.claudeAgent;
      const claudeBinaryPath = providerOptions?.binaryPath?.trim() || "claude";
      const claudeCwd = sessionInput.cwd ?? input.defaultCwd;
      const modelDiscoveryKey = claudeModelDiscoveryKey(claudeCwd, claudeBinaryPath);
      const modelSelection =
        sessionInput.modelSelection?.provider === "claudeAgent"
          ? sessionInput.modelSelection
          : undefined;
      const requestedEffort = trimOrNull(modelSelection?.options?.effort ?? null);
      const requestedAutoCompactWindow = trimOrNull(
        modelSelection?.options?.autoCompactWindow ??
          modelSelection?.options?.contextWindow ??
          null,
      );
      const effectiveClaudeModel = modelSelection?.model ?? getDefaultModel(PROVIDER);
      const caps = getModelCapabilities(PROVIDER, effectiveClaudeModel);
      const requestedAutoCompactWindowTokens = resolveSelectedClaudeAutoCompactWindow(
        effectiveClaudeModel,
        requestedAutoCompactWindow,
      );
      const requestedApiModelId = modelSelection ? resolveApiModelId(modelSelection) : undefined;
      const resumeOriginalModel = resumeState?.rerouteOriginalApiModelId;
      const resumeFallbackModel = resumeState?.rerouteFallbackApiModelId;
      const resumedRerouteMatchesSelection =
        resumeOriginalModel !== undefined &&
        resumeFallbackModel !== undefined &&
        (requestedApiModelId === undefined ||
          stripClaudeContextWindowSuffix(requestedApiModelId) ===
            stripClaudeContextWindowSuffix(resumeOriginalModel));
      const resumedOriginalModel = resumedRerouteMatchesSelection ? resumeOriginalModel : undefined;
      const resumedFallbackModel = resumedRerouteMatchesSelection
        ? stripClaudeContextWindowSuffix(resumeFallbackModel)
        : undefined;
      const apiModelId = resumedFallbackModel ?? requestedApiModelId;
      const effort =
        requestedEffort && hasEffortLevel(caps, requestedEffort) ? requestedEffort : null;
      const fastMode = modelSelection?.options?.fastMode === true && caps.supportsFastMode;
      const thinking =
        typeof modelSelection?.options?.thinking === "boolean" && caps.supportsThinkingToggle
          ? modelSelection.options.thinking
          : undefined;
      const effectiveEffort = getEffectiveClaudeCodeEffort(effort);
      const ultracode = effort === "ultracode" && hasEffortLevel(caps, "xhigh");
      const permissionMode =
        toPermissionMode(providerOptions?.permissionMode) ??
        (sessionInput.runtimeMode === "full-access" ? "bypassPermissions" : undefined);
      const subagents = buildClaudeSdkSubagents();
      const env = yield* input.resolveSdkEnv;

      const queryOptions: ClaudeQueryOptions = {
        cwd: claudeCwd,
        ...(apiModelId ? { model: apiModelId } : {}),
        pathToClaudeCodeExecutable: claudeBinaryPath,
        settingSources: [...SETTING_SOURCES],
        systemPrompt: { type: "preset", preset: "claude_code" },
        ...(Object.keys(subagents).length > 0 ? { agents: subagents } : {}),
        ...(effectiveEffort
          ? { effort: effectiveEffort as "low" | "medium" | "high" | "xhigh" | "max" }
          : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(providerOptions?.maxThinkingTokens !== undefined
          ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
          : {}),
        settings: {
          autoCompactEnabled: true,
          ...(requestedAutoCompactWindowTokens !== undefined
            ? { autoCompactWindow: requestedAutoCompactWindowTokens }
            : {}),
          ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
          ...(fastMode ? { fastMode: true } : {}),
          ...(ultracode ? { ultracode: true } : {}),
        },
        ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
        ...(newSessionId ? { sessionId: newSessionId } : {}),
        includePartialMessages: true,
        forwardSubagentText: true,
        canUseTool,
        env,
        ...(sessionInput.cwd ? { additionalDirectories: [sessionInput.cwd] } : {}),
      };

      const queryRuntime = yield* Effect.try({
        try: () => input.createQuery({ prompt, options: queryOptions }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: toMessage(cause, "Failed to start Claude runtime session."),
            cause,
          }),
      });

      let installationContext: ClaudeSessionContext | undefined;
      let installationComplete = false;
      return yield* Effect.gen(function* () {
        input.prefetchCapabilities(modelDiscoveryKey, queryRuntime);
        const session: ProviderSession = {
          threadId,
          provider: PROVIDER,
          status: "ready",
          runtimeMode: sessionInput.runtimeMode,
          ...(sessionInput.cwd ? { cwd: sessionInput.cwd } : {}),
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          resumeCursor: {
            threadId,
            ...(sessionId ? { resume: sessionId } : {}),
            ...(resumeState?.resumeSessionAt
              ? { resumeSessionAt: resumeState.resumeSessionAt }
              : {}),
            turnCount: resumeState?.turnCount ?? 0,
            ...(resumedOriginalModel && resumedFallbackModel
              ? {
                  rerouteOriginalApiModelId: resumedOriginalModel,
                  rerouteFallbackApiModelId: resumedFallbackModel,
                }
              : {}),
            ...(trackedTasks.size > 0 ? { trackedTasks: Array.from(trackedTasks.values()) } : {}),
          },
          createdAt: startedAt,
          updatedAt: startedAt,
        };

        const context: ClaudeSessionContext = {
          session,
          promptQueue,
          query: queryRuntime,
          modelDiscoveryKey,
          streamFiber: undefined,
          startedAt,
          basePermissionMode: permissionMode,
          lastInteractionMode: undefined,
          currentApiModelId: apiModelId,
          resumeSessionId: sessionId,
          pendingApprovals,
          pendingUserInputs,
          turns: [],
          inFlightTools,
          trackedTasks,
          turnState: undefined,
          interruptRequestedTurnId: undefined,
          lastKnownContextWindow: resolveClaudeApiModelIdContextWindowMaxTokens(
            apiModelId ?? effectiveClaudeModel,
          ),
          currentAutoCompactWindow: requestedAutoCompactWindowTokens,
          lastKnownAutoCompactThreshold: requestedAutoCompactWindowTokens,
          contextUsageControlEnabled: true,
          lastKnownTokenUsage: undefined,
          lastAssistantUuid: resumeState?.resumeSessionAt,
          lastThreadStartedId: undefined,
          rerouteOriginalApiModelId: resumedOriginalModel,
          emittedContextUsageWarnings: new Set(),
          stopped: false,
          warnedUnhandledSdkKinds: new Set(),
          subagentRoutes: new ClaudeSubagentRouteRegistry(),
          subagentRuns: new Map(),
        };
        installationContext = context;
        yield* input.withLifecycleLock(
          threadId,
          Effect.gen(function* () {
            const existing = input.getSession(threadId);
            if (existing && existing !== context) {
              yield* input.stopSessionInternal(existing, { emitExitEvent: false });
            }

            yield* Ref.set(contextRef, context);
            input.installSession(threadId, context);
            const startedStamp = yield* input.makeEventStamp();
            yield* input.offerRuntimeEvent({
              type: "session.started",
              eventId: startedStamp.eventId,
              provider: PROVIDER,
              createdAt: startedStamp.createdAt,
              threadId,
              payload:
                sessionInput.resumeCursor !== undefined
                  ? { resume: sessionInput.resumeCursor }
                  : {},
              providerRefs: {},
            });

            const configuredStamp = yield* input.makeEventStamp();
            yield* input.offerRuntimeEvent({
              type: "session.configured",
              eventId: configuredStamp.eventId,
              provider: PROVIDER,
              createdAt: configuredStamp.createdAt,
              threadId,
              payload: {
                config: {
                  ...(modelSelection?.model ? { model: modelSelection.model } : {}),
                  ...(apiModelId ? { apiModelId } : {}),
                  ...(requestedAutoCompactWindow
                    ? { autoCompactWindow: requestedAutoCompactWindow }
                    : {}),
                  ...(sessionInput.cwd ? { cwd: sessionInput.cwd } : {}),
                  ...(effectiveEffort ? { effort: effectiveEffort } : {}),
                  ...(permissionMode ? { permissionMode } : {}),
                  ...(providerOptions?.maxThinkingTokens !== undefined
                    ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
                    : {}),
                  ...(fastMode ? { fastMode: true } : {}),
                  ...(ultracode ? { ultracode: true } : {}),
                },
              },
              providerRefs: {},
            });

            const readyStamp = yield* input.makeEventStamp();
            yield* input.offerRuntimeEvent({
              type: "session.state.changed",
              eventId: readyStamp.eventId,
              provider: PROVIDER,
              createdAt: readyStamp.createdAt,
              threadId,
              payload: { state: "ready" },
              providerRefs: {},
            });

            if (context.currentAutoCompactWindow === CLAUDE_ONE_MILLION_CONTEXT_WINDOW_TOKENS) {
              context.emittedContextUsageWarnings.add("one-million-window");
              yield* input.emitRuntimeWarning(
                context,
                "Claude's auto-compact budget is set to the model's 1M limit for this thread. Long conversations can consume usage limits much faster; switch Auto-compact to 200k unless the larger working context is intentional.",
              );
            }

            const streamFiber = Effect.runFork(input.runSdkStream(context));
            context.streamFiber = streamFiber;
            streamFiber.addObserver((exit) => {
              if (context.stopped) return;
              if (context.streamFiber === streamFiber) {
                context.streamFiber = undefined;
              }
              Effect.runFork(input.handleStreamExit(context, exit));
            });
          }),
        );

        installationComplete = true;
        return { ...session };
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            if (installationComplete) return Effect.void;
            if (installationContext !== undefined) {
              return input.stopSessionInternal(installationContext, {
                emitExitEvent: false,
              });
            }
            return Effect.gen(function* () {
              yield* Queue.shutdown(promptQueue);
              const closeExit = yield* Effect.exit(Effect.sync(() => queryRuntime.close()));
              if (Exit.isFailure(closeExit)) {
                yield* Effect.logWarning("claude.session.failed_install_cleanup", {
                  threadId,
                  cause: Cause.pretty(closeExit.cause),
                });
              }
            });
          }),
        ),
      );
    });
}
