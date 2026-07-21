import crypto from "node:crypto";

import type { ImageContent } from "@earendil-works/pi-ai";
import {
  type ApprovalRequestId,
  type ChatAttachment,
  EventId,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Effect, FileSystem } from "effect";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "./Errors.ts";
import type { PiAdapterShape } from "./Services/PiAdapter.ts";
import { appendFileAttachmentsPromptBlock } from "./attachmentProjection.ts";
import {
  PROVIDER,
  getSessionFile,
  isPiReloadCommand,
  makeSessionSnapshot,
  normalizePiThinkingLevel,
  type PiSessionContext,
  toMessage,
} from "./piAdapterCore.ts";
import type { makePiSessionRegistry } from "./piSessionRegistry.ts";
import { resolveFreshPiModel } from "./piModelRuntime.ts";

type PiSessionRegistry = ReturnType<typeof makePiSessionRegistry>;

export interface PiTurnControllerDependencies {
  readonly attachmentsDir: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly requireSession: PiSessionRegistry["requireSession"];
  readonly completePromptRejection: (
    context: PiSessionContext,
    turnId: TurnId,
    cause: unknown,
  ) => void;
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
  readonly offerRuntimeError: (
    context: PiSessionContext,
    input: {
      readonly message: string;
      readonly cause?: unknown;
      readonly method: string;
      readonly messageType?: string;
    },
  ) => void;
  readonly resolvePiExtensionUserInput: (
    context: PiSessionContext,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => boolean;
}

export function makePiTurnController(dependencies: PiTurnControllerDependencies) {
  const {
    attachmentsDir,
    completePromptRejection,
    fileSystem,
    makeEventBase,
    offerRuntimeError,
    offerRuntimeEvent,
    requireSession,
    resolvePiExtensionUserInput,
  } = dependencies;
  const serverConfig = { attachmentsDir };
  const buildPromptPayload = (input: {
    readonly input?: string | undefined;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) =>
    Effect.gen(function* () {
      const text =
        appendFileAttachmentsPromptBlock({
          text: input.input,
          attachments: input.attachments,
          attachmentsDir: serverConfig.attachmentsDir,
          include: "all-files",
        }) ?? "";
      const images = yield* Effect.forEach(
        input.attachments ?? [],
        (attachment) =>
          Effect.gen(function* () {
            if (attachment.type !== "image" || !attachment.mimeType) return undefined;
            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!attachmentPath) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "turn/start",
                issue: `Invalid attachment id '${attachment.id}'.`,
              });
            }
            const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "turn/start",
                    detail: toMessage(cause, "Failed to read attachment file."),
                    cause,
                  }),
              ),
            );
            return {
              type: "image" as const,
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType,
            };
          }),
        { concurrency: 1 },
      );
      return {
        text,
        images: images.filter((image): image is ImageContent => image !== undefined),
      };
    });

  const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      if (context.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "A Pi turn is already active for this thread.",
        });
      }
      if (input.modelSelection?.provider === "pi") {
        const requestedModel = input.modelSelection.model;
        const model = yield* Effect.tryPromise({
          try: () => resolveFreshPiModel(context.runtime.services.modelRuntime, requestedModel),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "model/refresh",
              detail: toMessage(cause, "Failed to refresh Pi models."),
              cause,
            }),
        });
        if (!model) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "model/set",
            issue: `Pi model '${requestedModel}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
          });
        }
        yield* Effect.tryPromise({
          try: () => context.runtime.session.setModel(model),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "model/set",
              detail: toMessage(cause, "Failed to set Pi model."),
              cause,
            }),
        });
        const thinkingLevel = normalizePiThinkingLevel(input.modelSelection.options?.thinkingLevel);
        if (thinkingLevel) {
          context.runtime.session.setThinkingLevel(thinkingLevel);
        }
      }
      const payload = yield* buildPromptPayload(input);
      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      context.activeTurnId = turnId;
      context.turns.push({ id: turnId, items: [] });
      context.session = makeSessionSnapshot(context);
      if (payload.images.length === 0 && isPiReloadCommand(payload.text)) {
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "turn.started",
          payload: {
            ...(context.runtime.session.model
              ? {
                  model: `${context.runtime.session.model.provider}/${context.runtime.session.model.id}`,
                }
              : {}),
            effort: context.runtime.session.thinkingLevel,
          },
          raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
        } satisfies ProviderRuntimeEvent);
        yield* Effect.tryPromise({
          try: () => context.runtime.session.reload(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/reload",
              detail: toMessage(cause, "Failed to reload Pi resources."),
              cause,
            }),
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const message = error.message;
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "turn.completed",
                payload: { state: "failed", stopReason: "error", errorMessage: message },
                raw: { source: "pi.sdk.event", method: "reload", payload: error },
              } satisfies ProviderRuntimeEvent);
              offerRuntimeError(context, {
                message,
                method: "session/reload",
                cause: error,
              });
              context.activeTurnId = undefined;
              context.session = makeSessionSnapshot(context);
              return yield* Effect.fail(error);
            }),
          ),
        );
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "turn.completed",
          payload: { state: "completed", stopReason: "reload" },
          raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
        } satisfies ProviderRuntimeEvent);
        context.activeTurnId = undefined;
        context.session = makeSessionSnapshot(context);
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: getSessionFile(context.runtime.session),
        };
      }
      void context.runtime.session
        .prompt(payload.text, payload.images.length > 0 ? { images: payload.images } : undefined)
        .catch((cause) => {
          completePromptRejection(context, turnId, cause);
        });
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: getSessionFile(context.runtime.session),
      };
    });

  const steerTurn: NonNullable<PiAdapterShape["steerTurn"]> = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      const payload = yield* buildPromptPayload(input);
      const turnId = context.activeTurnId ?? TurnId.makeUnsafe(crypto.randomUUID());
      if (!context.activeTurnId) {
        context.activeTurnId = turnId;
        context.turns.push({ id: turnId, items: [] });
      }
      if (context.runtime.session.isStreaming) {
        yield* Effect.tryPromise({
          try: () => context.runtime.session.steer(payload.text, payload.images),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/steer",
              detail: toMessage(cause, "Failed to steer Pi turn."),
              cause,
            }),
        });
      } else {
        void context.runtime.session
          .prompt(payload.text, payload.images.length > 0 ? { images: payload.images } : undefined)
          .catch((cause) => {
            completePromptRejection(context, turnId, cause);
          });
      }
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: getSessionFile(context.runtime.session),
      };
    });

  const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.tryPromise({
          try: () => context.runtime.session.abort(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/interrupt",
              detail: toMessage(cause, "Failed to interrupt Pi turn."),
              cause,
            }),
        }),
      ),
      Effect.asVoid,
    );

  const respondUnsupported = (threadId: ThreadId, method: string) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail: `Pi does not expose Agent Group approval/user-input requests for thread ${threadId}.`,
      }),
    );

  const respondToUserInput: PiAdapterShape["respondToUserInput"] = (threadId, requestId, answers) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (!resolvePiExtensionUserInput(context, requestId, answers)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "user-input/respond",
          detail: `Unknown pending Pi user-input request: ${requestId}`,
        });
      }
    });

  return {
    interruptTurn,
    respondToUserInput,
    respondUnsupported,
    sendTurn,
    steerTurn,
  };
}
