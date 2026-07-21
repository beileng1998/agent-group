/**
 * ClaudeAdapterLive - Scoped live implementation for the Claude Agent provider adapter.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
 * provider adapter contract and emits canonical runtime events.
 *
 * @module ClaudeAdapterLive
 */
import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ProviderComposerCapabilities,
  type ProviderListSkillsInput,
  type ProviderListSkillsResult,
} from "@agent-group/contracts";
import { Effect, FileSystem, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { makeClaudeAssistantMessageProjection } from "../claudeAssistantMessageProjection.ts";
import { makeClaudeAssistantProjection } from "../claudeAssistantProjection.ts";
import type { ClaudeQueryRuntime } from "../claudeAdapterRuntime.ts";
import { makeClaudeCapabilityDiscovery } from "../claudeCapabilityDiscovery.ts";
import { makeClaudeContextUsage } from "../claudeContextUsage.ts";
import { buildClaudeProcessEnv } from "../claudeProcessEnv.ts";
import { readClaudeResumeState } from "../claudeAdapterProtocol.ts";
import { makeClaudeRuntimeEventSink } from "../claudeRuntimeEventSink.ts";
import { makeClaudeSdkMessageRouter } from "../claudeSdkMessageRouter.ts";
import { makeClaudeSessionFactory } from "../claudeSessionFactory.ts";
import { makeClaudeSessionLifecycle } from "../claudeSessionLifecycle.ts";
import { makeClaudeSessionRegistry } from "../claudeSessionRegistry.ts";
import { makeClaudeSessionState } from "../claudeSessionState.ts";
import { makeClaudeStreamEventProjection } from "../claudeStreamEventProjection.ts";
import { makeClaudeSubagentRuntime } from "../claudeSubagentRuntime.ts";
import { makeClaudeSystemMessageProjection } from "../claudeSystemMessageProjection.ts";
import { makeClaudeTurnActivity } from "../claudeTurnActivity.ts";
import { makeClaudeTurnCompletion } from "../claudeTurnCompletion.ts";
import { makeClaudeTurnController } from "../claudeTurnController.ts";
import { makeClaudeUserMessageProjection } from "../claudeUserMessageProjection.ts";
import { findClaudeTranscriptPath } from "../ProviderTranscriptPaths.ts";
import { ClaudeAdapter, type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "claudeAgent" as const;

export interface ClaudeAdapterLiveOptions {
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeQueryRuntime;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function makeClaudeAdapter(options?: ClaudeAdapterLiveOptions) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);

    const createQuery =
      options?.createQuery ??
      ((input: {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }) => query({ prompt: input.prompt, options: input.options }) as ClaudeQueryRuntime);

    const runtimeEvents = yield* makeClaudeRuntimeEventSink(nativeEventLogger);
    const {
      emitRuntimeError,
      emitRuntimeWarning,
      logNativeSdkMessage,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      warnUnhandledSdkKind,
    } = runtimeEvents;
    const {
      backfillFromSnapshot: backfillAssistantTextBlocksFromSnapshot,
      completeTextBlock: completeAssistantTextBlock,
      ensureTextBlock: ensureAssistantTextBlock,
    } = makeClaudeAssistantProjection({
      makeEventStamp,
      offerRuntimeEvent,
    });
    const {
      maybeEmitWarning: maybeEmitContextUsageWarning,
      read: readClaudeContextUsage,
      snapshot: snapshotFromClaudeContextUsage,
    } = makeClaudeContextUsage({ emitRuntimeWarning });
    const sessionRegistry = makeClaudeSessionRegistry();
    const {
      hasSession,
      listSessions,
      requireSession,
      withLifecycleLock: withSessionLifecycleLock,
    } = sessionRegistry;
    const resolveClaudeSdkEnv = Effect.sync(() =>
      buildClaudeProcessEnv({ env: process.env, homeDir: serverConfig.homeDir }),
    );
    const capabilityDiscovery = makeClaudeCapabilityDiscovery({
      createQuery,
      sessions: sessionRegistry.contexts,
      defaultCwd: serverConfig.cwd,
      resolveSdkEnv: resolveClaudeSdkEnv,
    });

    const { ensureThreadId, snapshotThread, updateResumeCursor } = makeClaudeSessionState({
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
    });

    const completeTurn = makeClaudeTurnCompletion({
      readContextUsage: readClaudeContextUsage,
      snapshotContextUsage: snapshotFromClaudeContextUsage,
      completeAssistantTextBlock,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      updateResumeCursor,
    });

    const {
      ensureRun: ensureSubagentRun,
      runForTask: subagentRunForTask,
      settleRun: settleSubagentRun,
    } = makeClaudeSubagentRuntime({
      completeTurn: (context, status, errorMessage) => completeTurn(context, status, errorMessage),
    });
    const {
      emitProposedPlanCompleted,
      emitTaskUsageSnapshot,
      emitTodoTasksUpdated,
      emitTrackedTasksUpdated,
      ensureSyntheticTurn,
    } = makeClaudeTurnActivity({
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      subagentRunForTask,
    });

    const handleStreamEvent = makeClaudeStreamEventProjection({
      completeAssistantTextBlock,
      emitTodoTasksUpdated,
      ensureAssistantTextBlock,
      makeEventStamp,
      offerRuntimeEvent,
    });
    const handleUserMessage = makeClaudeUserMessageProjection({
      emitTrackedTasksUpdated,
      makeEventStamp,
      offerRuntimeEvent,
      updateResumeCursor,
    });
    const { handleAssistantMessage, handleResultMessage } = makeClaudeAssistantMessageProjection({
      backfillAssistantTextBlocksFromSnapshot,
      completeTurn,
      emitProposedPlanCompleted,
      emitRuntimeError,
      ensureSyntheticTurn,
      makeEventStamp,
      maybeEmitContextUsageWarning,
      offerRuntimeEvent,
      updateResumeCursor,
    });
    const { handleSystemMessage, handleTelemetryMessage: handleSdkTelemetryMessage } =
      makeClaudeSystemMessageProjection({
        emitRuntimeError,
        emitTaskUsageSnapshot,
        ensureSubagentRun,
        ensureSyntheticTurn,
        makeEventStamp,
        offerRuntimeEvent,
        resolveModelCapabilities: capabilityDiscovery.resolveModelCapabilities,
        settleSubagentRun,
        updateResumeCursor,
        warnUnhandledSdkKind,
      });

    const handleSdkMessage = makeClaudeSdkMessageRouter({
      ensureSubagentRun,
      ensureSyntheticTurn,
      ensureThreadId,
      handleAssistantMessage,
      handleResultMessage,
      handleStreamEvent,
      handleSystemMessage,
      handleTelemetryMessage: handleSdkTelemetryMessage,
      handleUserMessage,
      logNativeSdkMessage,
      warnUnhandledSdkKind,
    });

    const { handleStreamExit, runSdkStream, stopSessionInternal } = makeClaudeSessionLifecycle({
      completeTurn: (context, status, errorMessage) => completeTurn(context, status, errorMessage),
      emitRuntimeError,
      handleSdkMessage,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      removeSessionIfCurrent: sessionRegistry.removeIfCurrent,
      settleSubagentRun,
    });

    const startSession = makeClaudeSessionFactory({
      createQuery,
      defaultCwd: serverConfig.cwd,
      emitProposedPlanCompleted,
      emitRuntimeWarning,
      getSession: sessionRegistry.get,
      handleStreamExit,
      installSession: sessionRegistry.install,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      prefetchCapabilities: capabilityDiscovery.prefetchFromQuery,
      resolveModelCapabilities: capabilityDiscovery.resolveModelCapabilities,
      resolveSdkEnv: resolveClaudeSdkEnv,
      runSdkStream,
      stopSessionInternal,
      withLifecycleLock: withSessionLifecycleLock,
    });

    const {
      interruptTurn,
      readThread,
      respondToRequest,
      respondToUserInput,
      rollbackThread,
      sendTurn,
      stopSession,
    } = makeClaudeTurnController({
      attachmentsDir: serverConfig.attachmentsDir,
      completeTurn: (context, status, errorMessage) => completeTurn(context, status, errorMessage),
      emitTrackedTasksUpdated,
      fileSystem,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      requireSession,
      resolveModelCapabilities: capabilityDiscovery.resolveModelCapabilities,
      snapshotThread,
      stopSessionInternal,
      updateResumeCursor,
      withLifecycleLock: withSessionLifecycleLock,
    });

    const listCommands: NonNullable<ClaudeAdapterShape["listCommands"]> =
      capabilityDiscovery.listCommands;

    const listSkills: NonNullable<ClaudeAdapterShape["listSkills"]> = (
      _input: ProviderListSkillsInput,
    ) =>
      Effect.succeed({
        skills: [],
        source: "unsupported",
        cached: false,
      } satisfies ProviderListSkillsResult);

    const stopAll: ClaudeAdapterShape["stopAll"] = () =>
      Effect.forEach(
        sessionRegistry.contexts,
        ([, context]) =>
          stopSessionInternal(context, {
            emitExitEvent: true,
          }),
        { discard: true },
      );

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        sessionRegistry.contexts,
        ([, context]) =>
          stopSessionInternal(context, {
            emitExitEvent: false,
          }),
        { discard: true },
      ).pipe(Effect.tap(() => runtimeEvents.shutdown)),
    );

    const composerCapabilities: ProviderComposerCapabilities = {
      provider: PROVIDER,
      supportsSkillMentions: false,
      supportsSkillDiscovery: false,
      supportsNativeSlashCommandDiscovery: true,
      supportsPluginMentions: false,
      supportsPluginDiscovery: false,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: false,
      supportsThreadImport: true,
    };

    const getComposerCapabilities: NonNullable<
      ClaudeAdapterShape["getComposerCapabilities"]
    > = () => Effect.succeed(composerCapabilities);

    const listModels: NonNullable<ClaudeAdapterShape["listModels"]> =
      capabilityDiscovery.listModels;

    const listAgents: NonNullable<ClaudeAdapterShape["listAgents"]> = (_input) =>
      capabilityDiscovery.listAgents();

    const resolveTranscriptPath: NonNullable<ClaudeAdapterShape["resolveTranscriptPath"]> = (
      input,
    ) => {
      const sessionId = readClaudeResumeState(input.resumeCursor)?.resume;
      return sessionId
        ? Effect.promise(() =>
            findClaudeTranscriptPath({ homeDir: serverConfig.homeDir, sessionId }),
          )
        : Effect.succeed(null);
    };

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        supportsSkillMentions: false,
        supportsSkillDiscovery: false,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsLiveTurnDiffPatch: false,
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      getComposerCapabilities,
      listCommands,
      listSkills,
      listModels,
      listAgents,
      resolveTranscriptPath,
      streamEvents: runtimeEvents.streamEvents,
    } satisfies ClaudeAdapterShape;
  });
}

export const ClaudeAdapterLive = Layer.effect(ClaudeAdapter, makeClaudeAdapter());

export function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  return Layer.effect(ClaudeAdapter, makeClaudeAdapter(options));
}
