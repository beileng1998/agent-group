import {
  ApprovalRequestId,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { Deferred, Effect } from "effect";

import {
  selectAcpFullAccessPermissionOptionId,
  selectAcpPermissionOptionId,
} from "./acp/AcpAdapterSupport.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import {
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "./acp/AcpRuntimeModel.ts";
import { isGrokAcpDebugEnabled } from "./grokAdapterLogging.ts";
import type { GrokSessionContext, PendingApproval } from "./grokAdapterSessionState.ts";

const PROVIDER = "grok" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function registerGrokProtocolHandlers(input: {
  readonly acp: AcpSessionRuntimeShape;
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly getContext: () => GrokSessionContext | undefined;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
}): Effect.Effect<void> {
  return input.acp.handleRequestPermission((params) =>
    Effect.gen(function* () {
      yield* input.logNative(input.threadId, "session/request_permission", params);
      if (input.runtimeMode === "full-access") {
        const optionId = selectAcpFullAccessPermissionOptionId(params.options);
        if (optionId !== undefined) {
          if (isGrokAcpDebugEnabled()) {
            yield* Effect.logInfo("grok.acp.permission_auto_approved", {
              threadId: input.threadId,
              turnId: input.getContext()?.activeTurnId,
              optionId,
              options: params.options.map((option) => ({
                kind: option.kind,
                optionId: option.optionId,
              })),
              toolKind: params.toolCall.kind,
              toolTitle: params.toolCall.title,
            });
          }
          return { outcome: { outcome: "selected" as const, optionId } };
        }
        yield* Effect.logWarning("grok.acp.permission_auto_approve_unavailable", {
          threadId: input.threadId,
          turnId: input.getContext()?.activeTurnId,
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
          turnId: input.getContext()?.activeTurnId,
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
      if (resolved === "cancel") {
        return { outcome: { outcome: "cancelled" as const } };
      }
      const optionId = selectAcpPermissionOptionId(resolved, params.options);
      return optionId === undefined
        ? { outcome: { outcome: "cancelled" as const } }
        : { outcome: { outcome: "selected" as const, optionId } };
    }),
  );
}
