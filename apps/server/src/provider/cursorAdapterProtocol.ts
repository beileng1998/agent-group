import {
  ApprovalRequestId,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  type ThreadId,
} from "@agent-group/contracts";
import { Deferred, Effect } from "effect";

import {
  selectAcpFullAccessPermissionOptionId,
  selectAcpPermissionOptionId,
} from "./acp/AcpAdapterSupport.ts";
import {
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "./acp/AcpRuntimeModel.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import {
  CursorAskQuestionRequest,
  CursorCreatePlanRequest,
  CursorUpdateTodosRequest,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
} from "./acp/CursorAcpExtension.ts";
import type {
  CursorSessionContext,
  PendingApproval,
  PendingUserInput,
} from "./cursorAdapterSessionState.ts";

const PROVIDER = "cursor" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type CursorNativeSource = "acp.jsonrpc" | "acp.cursor.extension";

export function registerCursorProtocolHandlers(input: {
  readonly acp: AcpSessionRuntimeShape;
  readonly threadId: ThreadId;
  readonly runtimeMode: "full-access" | "approval-required";
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly getContext: () => CursorSessionContext | undefined;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (
    threadId: ThreadId,
    method: string,
    payload: unknown,
    source: CursorNativeSource,
  ) => Effect.Effect<void>;
  readonly completePlanTurn: (
    ctx: CursorSessionContext,
    turnId: NonNullable<CursorSessionContext["activeTurnId"]>,
    activePromptFiber: CursorSessionContext["activePromptFiber"],
  ) => Effect.Effect<void>;
  readonly emitPlanUpdate: (
    ctx: CursorSessionContext,
    payload: {
      readonly explanation?: string | null;
      readonly plan: ReadonlyArray<{
        readonly step: string;
        readonly status: "pending" | "inProgress" | "completed";
      }>;
    },
    rawPayload: unknown,
    source: CursorNativeSource,
    method: string,
  ) => Effect.Effect<void>;
}): Effect.Effect<void> {
  const context = () => input.getContext();
  return Effect.gen(function* () {
    yield* input.acp.handleExtRequest("cursor/ask_question", CursorAskQuestionRequest, (params) =>
      Effect.gen(function* () {
        yield* input.logNative(
          input.threadId,
          "cursor/ask_question",
          params,
          "acp.cursor.extension",
        );
        const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
        const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);
        const answers = yield* Deferred.make<ProviderUserInputAnswers>();
        input.pendingUserInputs.set(requestId, { answers });
        yield* input.offerRuntimeEvent({
          type: "user-input.requested",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId: context()?.activeTurnId,
          requestId: runtimeRequestId,
          payload: { questions: extractAskQuestions(params) },
          raw: {
            source: "acp.cursor.extension",
            method: "cursor/ask_question",
            payload: params,
          },
        });
        const resolved = yield* Deferred.await(answers);
        input.pendingUserInputs.delete(requestId);
        yield* input.offerRuntimeEvent({
          type: "user-input.resolved",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId: context()?.activeTurnId,
          requestId: runtimeRequestId,
          payload: { answers: resolved },
        });
        return { answers: resolved };
      }),
    );

    yield* input.acp.handleExtRequest("cursor/create_plan", CursorCreatePlanRequest, (params) =>
      Effect.gen(function* () {
        yield* input.logNative(
          input.threadId,
          "cursor/create_plan",
          params,
          "acp.cursor.extension",
        );
        const ctx = context();
        const turnId = ctx?.activeTurnId;
        const activePromptFiber = ctx?.activePromptFiber;
        const planMarkdown = extractPlanMarkdown(params);
        yield* input.offerRuntimeEvent({
          type: "turn.proposed.completed",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { planMarkdown },
          raw: {
            source: "acp.cursor.extension",
            method: "cursor/create_plan",
            payload: params,
          },
        });
        if (
          ctx &&
          turnId !== undefined &&
          ctx.activeInteractionMode === "plan" &&
          ctx.completedPlanFingerprint !== planMarkdown
        ) {
          ctx.completedPlanFingerprint = planMarkdown;
          yield* input.completePlanTurn(ctx, turnId, activePromptFiber);
        }
        return { accepted: true } as const;
      }),
    );

    const handleCursorUpdateTodos = (params: typeof CursorUpdateTodosRequest.Type) =>
      Effect.gen(function* () {
        yield* input.logNative(
          input.threadId,
          "cursor/update_todos",
          params,
          "acp.cursor.extension",
        );
        const ctx = context();
        if (ctx) {
          yield* input.emitPlanUpdate(
            ctx,
            extractTodosAsPlan(params),
            params,
            "acp.cursor.extension",
            "cursor/update_todos",
          );
        }
      });
    yield* input.acp.handleExtRequest("cursor/update_todos", CursorUpdateTodosRequest, (params) =>
      handleCursorUpdateTodos(params).pipe(Effect.as({ accepted: true } as const)),
    );
    yield* input.acp.handleExtNotification(
      "cursor/update_todos",
      CursorUpdateTodosRequest,
      handleCursorUpdateTodos,
    );

    yield* input.acp.handleRequestPermission((params) =>
      Effect.gen(function* () {
        yield* input.logNative(input.threadId, "session/request_permission", params, "acp.jsonrpc");
        if (input.runtimeMode === "full-access") {
          const autoApprovedOptionId = selectAcpFullAccessPermissionOptionId(params.options);
          if (autoApprovedOptionId !== undefined) {
            return { outcome: { outcome: "selected" as const, optionId: autoApprovedOptionId } };
          }
        }
        const permissionRequest = parsePermissionRequest(params);
        const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
        const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);
        const decision = yield* Deferred.make<ProviderApprovalDecision>();
        input.pendingApprovals.set(requestId, { decision, kind: permissionRequest.kind });
        yield* input.offerRuntimeEvent(
          makeAcpRequestOpenedEvent({
            stamp: yield* input.makeEventStamp(),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId: context()?.activeTurnId,
            requestId: runtimeRequestId,
            permissionRequest,
            detail: permissionRequest.detail ?? JSON.stringify(params).slice(0, 2000),
            args: params,
            source: "acp.jsonrpc",
            method: "session/request_permission",
            rawPayload: params,
          }),
        );
        const resolved = yield* Deferred.await(decision);
        input.pendingApprovals.delete(requestId);
        yield* input.offerRuntimeEvent(
          makeAcpRequestResolvedEvent({
            stamp: yield* input.makeEventStamp(),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId: context()?.activeTurnId,
            requestId: runtimeRequestId,
            permissionRequest,
            decision: resolved,
          }),
        );
        if (resolved === "cancel") return { outcome: { outcome: "cancelled" as const } };
        const selectedOptionId = selectAcpPermissionOptionId(resolved, params.options);
        return selectedOptionId === undefined
          ? { outcome: { outcome: "cancelled" as const } }
          : { outcome: { outcome: "selected" as const, optionId: selectedOptionId } };
      }),
    );
  });
}
