import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventId, ProviderItemId, type ProviderRuntimeEvent } from "@agent-group/contracts";
import { DateTime, Effect, Queue, Random, Stream } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId } from "./claudeAdapterProtocol.ts";
import { nativeProviderRefs, sdkNativeItemId, sdkNativeMethod } from "./claudeSdkMessage.ts";
import type { EventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeRuntimeEventSink(nativeEventLogger?: EventNdjsonLogger) {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(queue, event).pipe(Effect.asVoid);

    const logNativeSdkMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!nativeEventLogger) {
          return;
        }

        const observedAt = new Date().toISOString();
        const itemId = sdkNativeItemId(message);
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id:
                "uuid" in message && typeof message.uuid === "string"
                  ? message.uuid
                  : crypto.randomUUID(),
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method: sdkNativeMethod(message),
              ...(typeof message.session_id === "string"
                ? { providerThreadId: message.session_id }
                : {}),
              ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
              ...(itemId ? { itemId: ProviderItemId.makeUnsafe(itemId) } : {}),
              payload: message,
            },
          },
          context.session.threadId,
        );
      });

    const emitRuntimeError = (
      context: ClaudeSessionContext,
      message: string,
      cause?: unknown,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "runtime.error",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          payload: {
            message,
            class: "provider_error",
            ...(cause !== undefined ? { detail: cause } : {}),
          },
          providerRefs: nativeProviderRefs(context),
        });
      });

    const emitRuntimeWarning = (
      context: ClaudeSessionContext,
      message: string,
      detail?: unknown,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "runtime.warning",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          payload: {
            message,
            ...(detail !== undefined ? { detail } : {}),
          },
          providerRefs: nativeProviderRefs(context),
        });
      });

    const warnUnhandledSdkKind = (
      context: ClaudeSessionContext,
      kind: string,
      message: string,
      detail?: unknown,
    ): Effect.Effect<void> => {
      if (context.warnedUnhandledSdkKinds.has(kind)) {
        return Effect.void;
      }
      context.warnedUnhandledSdkKinds.add(kind);
      return emitRuntimeWarning(context, message, detail);
    };

    return {
      emitRuntimeError,
      emitRuntimeWarning,
      logNativeSdkMessage,
      makeEventStamp,
      nowIso,
      offerRuntimeEvent,
      shutdown: Queue.shutdown(queue),
      streamEvents: Stream.fromQueue(queue),
      warnUnhandledSdkKind,
    };
  });
}
