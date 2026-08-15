// FILE: claudePendingInteractions.ts
// Purpose: Settles Claude approvals and questions exactly once with stable ownership.
// Layer: Server provider lifecycle helper

import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type TurnId,
  type UserInputQuestion,
} from "@agent-group/contracts";
import { Deferred, Effect } from "effect";

import type {
  ClaudePendingApproval,
  ClaudePendingUserInput,
  ClaudePendingUserInputResult,
  ClaudeSessionContext,
} from "./claudeAdapterRuntime.ts";
import { asRuntimeRequestId } from "./claudeAdapterProtocol.ts";
import { nativeProviderRefs } from "./claudeSdkMessage.ts";

const PROVIDER = "claudeAgent" as const;

function coerceAnswerValue(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").join(", ")
    : "";
}

export function remapClaudeUserInputAnswers(
  questions: ReadonlyArray<UserInputQuestion>,
  answers: ProviderUserInputAnswers,
): Record<string, string> {
  const remapped = Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, coerceAnswerValue(value)]),
  );
  for (const question of questions) {
    if (!Object.hasOwn(remapped, question.question) && Object.hasOwn(remapped, question.id)) {
      remapped[question.question] = remapped[question.id]!;
      delete remapped[question.id];
    }
  }
  return remapped;
}

export function makeClaudePendingInteractions(input: {
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}) {
  const settleApproval = (
    context: ClaudeSessionContext,
    requestId: ApprovalRequestId,
    pending: ClaudePendingApproval,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<ProviderApprovalDecision> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const ownsSettlement = yield* Effect.sync(() => {
          if (context.pendingApprovals.get(requestId) !== pending || pending.settlementStarted) {
            return false;
          }
          pending.settlementStarted = true;
          return true;
        });
        if (!ownsSettlement) return yield* Deferred.await(pending.settled);

        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "request.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { requestType: pending.requestType, decision },
          providerRefs: nativeProviderRefs(context, { providerItemId: pending.providerItemId }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/decision",
            payload: { decision },
          },
        });
        context.pendingApprovals.delete(requestId);
        yield* Deferred.succeed(pending.decision, decision);
        yield* Deferred.succeed(pending.settled, decision);
        return decision;
      }),
    );

  const settleUserInput = (
    context: ClaudeSessionContext,
    requestId: ApprovalRequestId,
    pending: ClaudePendingUserInput,
    result: ClaudePendingUserInputResult,
  ): Effect.Effect<ClaudePendingUserInputResult> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const ownsSettlement = yield* Effect.sync(() => {
          if (context.pendingUserInputs.get(requestId) !== pending || pending.settlementStarted) {
            return false;
          }
          pending.settlementStarted = true;
          return true;
        });
        if (!ownsSettlement) return yield* Deferred.await(pending.settled);

        const answers = remapClaudeUserInputAnswers(pending.questions, result.answers);
        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "user-input.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
          providerRefs: nativeProviderRefs(context, { providerItemId: pending.providerItemId }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/AskUserQuestion/resolved",
            payload: { answers, cancelled: result.cancelled },
          },
        });
        context.pendingUserInputs.delete(requestId);
        yield* Deferred.succeed(pending.result, result);
        yield* Deferred.succeed(pending.settled, result);
        return result;
      }),
    );

  const settleMatching = (
    context: ClaudeSessionContext,
    matches: (pending: Pick<ClaudePendingApproval, "agentId" | "turnId">) => boolean,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const [requestId, pending] of context.pendingApprovals) {
        if (matches(pending)) yield* settleApproval(context, requestId, pending, "cancel");
      }
      for (const [requestId, pending] of context.pendingUserInputs) {
        if (matches(pending)) {
          yield* settleUserInput(context, requestId, pending, { answers: {}, cancelled: true });
        }
      }
    });

  return {
    settleApproval,
    settleUserInput,
    settleForAgent: (context: ClaudeSessionContext, agentId: string) =>
      settleMatching(context, (pending) => pending.agentId === agentId),
    settleForTurn: (context: ClaudeSessionContext, turnId: TurnId) =>
      settleMatching(
        context,
        (pending) =>
          pending.turnId === turnId &&
          (pending.agentId === undefined || context.terminalTaskIds.has(pending.agentId)),
      ),
    settleForSession: (context: ClaudeSessionContext) => settleMatching(context, () => true),
  };
}

export type ClaudePendingInteractions = ReturnType<typeof makeClaudePendingInteractions>;
