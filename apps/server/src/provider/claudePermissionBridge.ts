import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type UserInputQuestion,
} from "@agent-group/contracts";
import { Deferred, Effect, Random, Ref } from "effect";

import type {
  ClaudePendingApproval,
  ClaudePendingUserInput,
  ClaudePendingUserInputResult,
  ClaudeSessionContext,
} from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId, asRuntimeRequestId } from "./claudeAdapterProtocol.ts";
import {
  remapClaudeUserInputAnswers,
  type ClaudePendingInteractions,
} from "./claudePendingInteractions.ts";
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

export function makeClaudePermissionBridge(input: {
  readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>;
  readonly runtimeMode: string | undefined;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly emitProposedPlanCompleted: (
    context: ClaudeSessionContext,
    capture: ClaudeProposedPlanCapture,
  ) => Effect.Effect<void>;
  readonly pendingInteractions: Pick<
    ClaudePendingInteractions,
    "settleApproval" | "settleUserInput"
  >;
}) {
  const pendingApprovals = new Map<ApprovalRequestId, ClaudePendingApproval>();
  const pendingUserInputs = new Map<ApprovalRequestId, ClaudePendingUserInput>();

  const handleAskUserQuestion = (
    context: ClaudeSessionContext,
    toolInput: Record<string, unknown>,
    callbackOptions: Parameters<CanUseTool>[2],
  ) =>
    Effect.gen(function* () {
      const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
      const interactionTurnId =
        context.turnState?.turnId ??
        (callbackOptions.agentID !== undefined ? context.turns.at(-1)?.id : undefined);
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

      const resultDeferred = yield* Deferred.make<ClaudePendingUserInputResult>();
      const settledDeferred = yield* Deferred.make<ClaudePendingUserInputResult>();
      const pendingInput: ClaudePendingUserInput = {
        questions,
        result: resultDeferred,
        settled: settledDeferred,
        ...(interactionTurnId ? { turnId: interactionTurnId } : {}),
        ...(callbackOptions.toolUseID ? { providerItemId: callbackOptions.toolUseID } : {}),
        ...(callbackOptions.agentID ? { agentId: callbackOptions.agentID } : {}),
        settlementStarted: false,
      };

      const requestedStamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "user-input.requested",
        eventId: requestedStamp.eventId,
        provider: PROVIDER,
        createdAt: requestedStamp.createdAt,
        threadId: context.session.threadId,
        ...(interactionTurnId ? { turnId: asCanonicalTurnId(interactionTurnId) } : {}),
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

      pendingUserInputs.set(requestId, pendingInput);
      if (callbackOptions.agentID && context.terminalTaskIds.has(callbackOptions.agentID)) {
        yield* input.pendingInteractions.settleUserInput(context, requestId, pendingInput, {
          answers: {},
          cancelled: true,
        });
      }

      const onAbort = () => {
        Effect.runFork(
          input.pendingInteractions.settleUserInput(context, requestId, pendingInput, {
            answers: {},
            cancelled: true,
          }),
        );
      };
      callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

      const result = yield* Deferred.await(resultDeferred).pipe(
        Effect.ensuring(
          Effect.sync(() => callbackOptions.signal.removeEventListener("abort", onAbort)),
        ),
      );

      if (result.cancelled) {
        return {
          behavior: "deny",
          message: "User cancelled tool execution.",
        } satisfies PermissionResult;
      }

      return {
        behavior: "allow",
        updatedInput: {
          questions: toolInput.questions,
          answers: remapClaudeUserInputAnswers(questions, result.answers),
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
        const interactionTurnId =
          context.turnState?.turnId ??
          (callbackOptions.agentID !== undefined ? context.turns.at(-1)?.id : undefined);
        const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const settledDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const pendingApproval: ClaudePendingApproval = {
          requestType,
          detail,
          decision: decisionDeferred,
          settled: settledDeferred,
          ...(interactionTurnId ? { turnId: interactionTurnId } : {}),
          ...(callbackOptions.toolUseID ? { providerItemId: callbackOptions.toolUseID } : {}),
          ...(callbackOptions.agentID ? { agentId: callbackOptions.agentID } : {}),
          settlementStarted: false,
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
          ...(interactionTurnId ? { turnId: asCanonicalTurnId(interactionTurnId) } : {}),
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
        if (callbackOptions.agentID && context.terminalTaskIds.has(callbackOptions.agentID)) {
          yield* input.pendingInteractions.settleApproval(
            context,
            requestId,
            pendingApproval,
            "cancel",
          );
        }
        const onAbort = () => {
          Effect.runFork(
            input.pendingInteractions.settleApproval(
              context,
              requestId,
              pendingApproval,
              "cancel",
            ),
          );
        };
        callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

        const decision = yield* Deferred.await(decisionDeferred).pipe(
          Effect.ensuring(
            Effect.sync(() => callbackOptions.signal.removeEventListener("abort", onAbort)),
          ),
        );

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
