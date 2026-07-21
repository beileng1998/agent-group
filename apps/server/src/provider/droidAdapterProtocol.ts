import {
  ApprovalRequestId,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { Deferred, Effect } from "effect";

import { selectAcpPermissionOptionId } from "./acp/AcpAdapterSupport.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import {
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "./acp/AcpRuntimeModel.ts";
import {
  elicitationQuestionsFromRequest,
  elicitationResponseFromAnswers,
} from "./acp/AcpElicitationSupport.ts";
import { isDroidAcpDebugEnabled } from "./droidAdapterLogging.ts";
import {
  type DroidSessionContext,
  type PendingApproval,
  type PendingUserInput,
  resolveDroidPermissionPolicy,
} from "./droidAdapterSessionState.ts";

const PROVIDER = "droid" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function registerDroidProtocolHandlers(input: {
  readonly acp: AcpSessionRuntimeShape;
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly getContext: () => DroidSessionContext | undefined;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* input.acp.handleRequestPermission((params) =>
      Effect.gen(function* () {
        yield* input.logNative(input.threadId, "session/request_permission", params);
        const ctx = input.getContext();
        const policyOutcome = resolveDroidPermissionPolicy({
          runtimeMode: input.runtimeMode,
          interactionMode: ctx?.activeInteractionMode,
          options: params.options,
        });
        if (policyOutcome !== undefined) {
          if (policyOutcome.outcome === "selected") {
            if (isDroidAcpDebugEnabled()) {
              yield* Effect.logInfo("droid.acp.permission_policy_applied", {
                threadId: input.threadId,
                turnId: ctx?.activeTurnId,
                interactionMode: ctx?.activeInteractionMode,
                optionId: policyOutcome.optionId,
                options: params.options.map((option) => ({
                  kind: option.kind,
                  optionId: option.optionId,
                })),
                toolKind: params.toolCall.kind,
                toolTitle: params.toolCall.title,
              });
            }
            return {
              outcome: { outcome: "selected" as const, optionId: policyOutcome.optionId },
            };
          }
          return { outcome: { outcome: "cancelled" as const } };
        }
        if (input.runtimeMode === "full-access") {
          yield* Effect.logWarning("droid.acp.permission_auto_approve_unavailable", {
            threadId: input.threadId,
            turnId: ctx?.activeTurnId,
            options: params.options.map((option) => ({
              kind: option.kind,
              optionId: option.optionId,
            })),
            toolKind: params.toolCall.kind,
            toolTitle: params.toolCall.title,
          });
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
            turnId: ctx?.activeTurnId,
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
            turnId: input.getContext()?.activeTurnId,
            requestId: runtimeRequestId,
            permissionRequest,
            decision: resolved,
          }),
        );
        if (resolved === "cancel") return { outcome: { outcome: "cancelled" as const } };
        const optionId = selectAcpPermissionOptionId(resolved, params.options);
        return optionId === undefined
          ? { outcome: { outcome: "cancelled" as const } }
          : { outcome: { outcome: "selected" as const, optionId } };
      }),
    );

    yield* input.acp.handleElicitation((params) =>
      Effect.gen(function* () {
        yield* input.logNative(input.threadId, "session/elicitation", params);
        if (params.mode !== "form") return { action: { action: "decline" as const } };
        const questions = elicitationQuestionsFromRequest(params);
        if (questions.length === 0) return { action: { action: "decline" as const } };
        const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
        const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);
        const answers = yield* Deferred.make<ProviderUserInputAnswers>();
        input.pendingUserInputs.set(requestId, { answers });
        yield* input.offerRuntimeEvent({
          type: "user-input.requested",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId: input.getContext()?.activeTurnId,
          requestId: runtimeRequestId,
          payload: { questions },
          raw: { source: "acp.jsonrpc", method: "session/elicitation", payload: params },
        });
        const resolved = yield* Deferred.await(answers);
        input.pendingUserInputs.delete(requestId);
        yield* input.offerRuntimeEvent({
          type: "user-input.resolved",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId: input.getContext()?.activeTurnId,
          requestId: runtimeRequestId,
          payload: { answers: resolved },
        });
        return elicitationResponseFromAnswers(params, resolved);
      }),
    );
  });
}
