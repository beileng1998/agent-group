import type { ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import { Effect, FileSystem, Layer, Queue, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { PROVIDER, type PiAdapterLiveOptions, type PiSessionContext } from "../piAdapterCore.ts";
import { makePiDiscovery } from "../piDiscovery.ts";
import { makePiEventSink } from "../piEventSink.ts";
import { makePiExtensionUi } from "../piExtensionUi.ts";
import { makePiSessionEventConsumer } from "../piSessionEventConsumer.ts";
import { makePiSessionLifecycle } from "../piSessionLifecycle.ts";
import { makePiSessionRegistry } from "../piSessionRegistry.ts";
import { makePiThreadOperations } from "../piThreadOperations.ts";
import { makePiTurnController } from "../piTurnController.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import { makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

export type { PiAdapterLiveOptions } from "../piAdapterCore.ts";
export { getPiSupportedThinkingOptions } from "../piAdapterCore.ts";
export { makePiUserInputOptions, PLAIN_PI_EXTENSION_THEME } from "../piExtensionUi.ts";

const makePiAdapter = (options?: PiAdapterLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, PiSessionContext>();
    const ownsNativeEventLogger = options?.nativeEventLogger === undefined;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);

    const { loadPiSdk, makeEventBase, offerRuntimeError, offerRuntimeEvent } = makePiEventSink({
      runtimeEventQueue,
      nativeEventLogger,
    });
    const { disposeSessionContext, requireSession } = makePiSessionRegistry(sessions);
    const { makePiExtensionUIContext, resolvePiExtensionUserInput } = makePiExtensionUi({
      makeEventBase,
      offerRuntimeEvent,
    });
    const { completePromptRejection, handleSessionEvent } = makePiSessionEventConsumer({
      makeEventBase,
      offerRuntimeError,
      offerRuntimeEvent,
    });
    const { hasSession, listSessions, resolveTranscriptPath, startSession, stopAll, stopSession } =
      makePiSessionLifecycle({
        defaultCwd: serverConfig.cwd,
        sessions,
        loadPiSdk,
        disposeSessionContext,
        handleSessionEvent,
        makePiExtensionUIContext,
        makeEventBase,
        offerRuntimeEvent,
        requireSession,
      });
    const { interruptTurn, respondToUserInput, respondUnsupported, sendTurn, steerTurn } =
      makePiTurnController({
        attachmentsDir: serverConfig.attachmentsDir,
        fileSystem,
        requireSession,
        completePromptRejection,
        makeEventBase,
        offerRuntimeEvent,
        offerRuntimeError,
        resolvePiExtensionUserInput,
      });
    const { compactThread, readThread, rollbackThread } = makePiThreadOperations(requireSession);
    const { getComposerCapabilities, listCommands, listModels, listSkills } = makePiDiscovery({
      defaultCwd: serverConfig.cwd,
      sessions,
    });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.ignore,
        Effect.andThen(
          ownsNativeEventLogger && nativeEventLogger
            ? nativeEventLogger.close().pipe(Effect.ignore)
            : Effect.void,
        ),
        Effect.andThen(Queue.shutdown(runtimeEventQueue)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
      },
      startSession,
      sendTurn,
      steerTurn,
      interruptTurn,
      respondToRequest: (threadId) => respondUnsupported(threadId, "request/respond"),
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      resolveTranscriptPath,
      rollbackThread,
      compactThread,
      stopAll,
      listModels,
      listSkills,
      listCommands,
      getComposerCapabilities,
      get streamEvents() {
        return Stream.fromQueue(runtimeEventQueue);
      },
    } satisfies PiAdapterShape;
  });

export const PiAdapterLive = Layer.effect(PiAdapter, makePiAdapter());

export function makePiAdapterLive(options?: PiAdapterLiveOptions) {
  return Layer.effect(PiAdapter, makePiAdapter(options));
}
