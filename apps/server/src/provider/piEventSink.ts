import crypto from "node:crypto";

import { EventId, type ProviderRuntimeEvent, type ThreadId } from "@agent-group/contracts";
import { Effect, Queue } from "effect";

import { ProviderAdapterRequestError } from "./Errors.ts";
import {
  PROVIDER,
  classifyPiRuntimeError,
  loadPiCodingAgentModule,
  runtimeErrorDetail,
  type PiSessionContext,
  toMessage,
} from "./piAdapterCore.ts";
import type { EventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";

export function makePiEventSink(input: {
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>;
  readonly nativeEventLogger?: EventNdjsonLogger | undefined;
}) {
  const { runtimeEventQueue, nativeEventLogger } = input;
  const loadPiSdk = (method: string) =>
    Effect.tryPromise({
      try: () => loadPiCodingAgentModule(),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method,
          detail: toMessage(cause, "Failed to load Pi SDK."),
          cause,
        }),
    });

  const makeEventBase = (
    context: PiSessionContext,
    options?: { readonly includeTurnId?: boolean },
  ) => ({
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    ...(options?.includeTurnId !== false && context.activeTurnId
      ? { turnId: context.activeTurnId }
      : {}),
  });

  const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
    Effect.runPromise(Queue.offer(runtimeEventQueue, event)).catch(() => undefined);
    if (nativeEventLogger && event.raw) {
      Effect.runPromise(nativeEventLogger.write(event.raw, event.threadId)).catch(() => undefined);
    }
  };

  const offerRuntimeError = (
    context: PiSessionContext,
    input: {
      readonly message: string;
      readonly cause?: unknown;
      readonly method: string;
      readonly messageType?: string;
    },
  ) => {
    offerRuntimeEvent({
      ...makeEventBase(context, { includeTurnId: false }),
      type: "runtime.error",
      payload: {
        message: input.message,
        class: classifyPiRuntimeError(input.message),
        ...(input.cause !== undefined ? { detail: runtimeErrorDetail(input.cause) } : {}),
      },
      raw: {
        source: "pi.sdk.event",
        method: input.method,
        ...(input.messageType ? { messageType: input.messageType } : {}),
        payload: input.cause ?? { message: input.message },
      },
    } satisfies ProviderRuntimeEvent);
  };

  return { loadPiSdk, makeEventBase, offerRuntimeError, offerRuntimeEvent };
}
