import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type UserInputQuestion,
} from "@agent-group/contracts";
import { Deferred, Effect, Random, Ref } from "effect";

import type {
  ClaudePendingApproval,
  ClaudePendingUserInput,
  ClaudeSessionContext,
} from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId, asRuntimeRequestId } from "./claudeAdapterProtocol.ts";
import { extractExitPlanModePlan, nativeProviderRefs } from "./claudeSdkMessage.ts";
import { classifyRequestType, summarizeToolRequest } from "./claudeToolMapping.ts";

const PROVIDER = "claudeAgent" as const;

export interface ClaudeProposedPlanCapture {
  readonly planMarkdown: string;
  readonly toolUseId?: string | undefined;
  readonly rawSource: "claude.sdk.message" | "claude.sdk.permission";
  readonly rawMethod: string;
  readonly rawPayload: unknown;
}

function coerceAnswerValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  }
  return "";
}

function remapAnswersToQuestionText(
  questions: ReadonlyArray<UserInputQuestion>,
  answers: ProviderUserInputAnswers,
): Record<string, string> {
  const remapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    remapped[key] = coerceAnswerValue(value);
  }

  for (const question of questions) {
    if (Object.hasOwn(remapped, question.question)) {
      continue;
    }
    if (Object.hasOwn(remapped, question.id)) {
      remapped[question.question] = remapped[question.id]!;
      delete remapped[question.id];
    }
  }
  return remapped;
}

export function makeClaudePermissionBridge(input: {
  readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>;
  readonly runtimeMode: string | undefined;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly emitProposedPlanCompleted: (
    context: ClaudeSessionContext,
    capture: ClaudeProposedPlanCapture,
  ) => Effect.Effect<void>;
}) {
  const pendingApprovals = new Map<ApprovalRequestId, ClaudePendingApproval>();
  const pendingUserInputs = new Map<ApprovalRequestId, ClaudePendingUserInput>();

  const handleAskUserQuestion = (
    context: ClaudeSessionContext,
    toolInput: Record<string, unknown>,
    callbackOptions: { readonly signal: AbortSignal; readonly toolUseID?: string },
  ) =>
    Effect.gen(function* () {
      const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
      const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      const questions: Array<UserInputQuestion> = rawQuestions.map(
        (question: Record<string, unknown>, index: number) => ({
          id: typeof question.header === "string" ? question.header : `q-${index}`,
          header: typeof question.header === "string" ? question.header : `Question ${index + 1}`,
          question: typeof question.question === "string" ? question.question : "",
          options: Array.isArray(question.options)
            ? question.options.map((option: Record<string, unknown>) => ({
                label: typeof option.label === "string" ? option.label : "",
                description: typeof option.description === "string" ? option.description : "",
              }))
            : [],
          multiSelect: typeof question.multiSelect === "boolean" ? question.multiSelect : false,
        }),
      );

      const answersDeferred = yield* Deferred.make<ProviderUserInputAnswers>();
      let aborted = false;
      pendingUserInputs.set(requestId, {
        questions,
        answers: answersDeferred,
      });

      const requestedStamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "user-input.requested",
        eventId: requestedStamp.eventId,
        provider: PROVIDER,
        createdAt: requestedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        requestId: asRuntimeRequestId(requestId),
        payload: { questions },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: callbackOptions.toolUseID,
        }),
        raw: {
          source: "claude.sdk.permission",
          method: "canUseTool/AskUserQuestion",
          payload: { toolName: "AskUserQuestion", input: toolInput },
        },
      });

      const onAbort = () => {
        if (!pendingUserInputs.has(requestId)) {
          return;
        }
        aborted = true;
        pendingUserInputs.delete(requestId);
        Effect.runFork(Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers));
      };
      callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

      const answers = remapAnswersToQuestionText(
        questions,
        yield* Deferred.await(answersDeferred).pipe(
          Effect.ensuring(
            Effect.sync(() => callbackOptions.signal.removeEventListener("abort", onAbort)),
          ),
        ),
      );
      pendingUserInputs.delete(requestId);

      const resolvedStamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "user-input.resolved",
        eventId: resolvedStamp.eventId,
        provider: PROVIDER,
        createdAt: resolvedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        requestId: asRuntimeRequestId(requestId),
        payload: { answers },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: callbackOptions.toolUseID,
        }),
        raw: {
          source: "claude.sdk.permission",
          method: "canUseTool/AskUserQuestion/resolved",
          payload: { answers },
        },
      });

      if (aborted) {
        return {
          behavior: "deny",
          message: "User cancelled tool execution.",
        } satisfies PermissionResult;
      }

      return {
        behavior: "allow",
        updatedInput: {
          questions: toolInput.questions,
          answers,
        },
      } satisfies PermissionResult;
    });

  const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Ref.get(input.contextRef);
        if (!context) {
          return {
            behavior: "deny",
            message: "Claude session context is unavailable.",
          } satisfies PermissionResult;
        }

        if (toolName === "AskUserQuestion") {
          return yield* handleAskUserQuestion(context, toolInput, callbackOptions);
        }

        if (toolName === "ExitPlanMode") {
          const planMarkdown = extractExitPlanModePlan(toolInput);
          if (planMarkdown) {
            yield* input.emitProposedPlanCompleted(context, {
              planMarkdown,
              toolUseId: callbackOptions.toolUseID,
              rawSource: "claude.sdk.permission",
              rawMethod: "canUseTool/ExitPlanMode",
              rawPayload: { toolName, input: toolInput },
            });
          }
          return {
            behavior: "deny",
            message:
              "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
          } satisfies PermissionResult;
        }

        if ((input.runtimeMode ?? "full-access") === "full-access") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
          } satisfies PermissionResult;
        }

        const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
        const requestType = classifyRequestType(toolName);
        const detail = summarizeToolRequest(toolName, toolInput);
        const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const pendingApproval: ClaudePendingApproval = {
          requestType,
          detail,
          decision: decisionDeferred,
          ...(callbackOptions.suggestions
            ? { suggestions: callbackOptions.suggestions as ReadonlyArray<PermissionUpdate> }
            : {}),
        };

        const requestedStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "request.opened",
          eventId: requestedStamp.eventId,
          provider: PROVIDER,
          createdAt: requestedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType,
            detail,
            args: {
              toolName,
              input: toolInput,
              ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
            },
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/request",
            payload: { toolName, input: toolInput },
          },
        });

        pendingApprovals.set(requestId, pendingApproval);
        const onAbort = () => {
          if (!pendingApprovals.has(requestId)) {
            return;
          }
          pendingApprovals.delete(requestId);
          Effect.runFork(Deferred.succeed(decisionDeferred, "cancel"));
        };
        callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

        const decision = yield* Deferred.await(decisionDeferred).pipe(
          Effect.ensuring(
            Effect.sync(() => callbackOptions.signal.removeEventListener("abort", onAbort)),
          ),
        );
        pendingApprovals.delete(requestId);

        const resolvedStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "request.resolved",
          eventId: resolvedStamp.eventId,
          provider: PROVIDER,
          createdAt: resolvedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { requestType, decision },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/decision",
            payload: { decision },
          },
        });

        if (decision === "accept" || decision === "acceptForSession") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
            ...(decision === "acceptForSession" && pendingApproval.suggestions
              ? { updatedPermissions: [...pendingApproval.suggestions] }
              : {}),
          } satisfies PermissionResult;
        }

        return {
          behavior: "deny",
          message:
            decision === "cancel"
              ? "User cancelled tool execution."
              : "User declined tool execution.",
        } satisfies PermissionResult;
      }),
    );

  return {
    canUseTool,
    pendingApprovals,
    pendingUserInputs,
  };
}
