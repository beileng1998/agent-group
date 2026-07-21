import { ApprovalRequestId } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { ProjectionPendingApprovalRepository } from "../../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionThreadSessionRepository } from "../../../persistence/Services/ProjectionThreadSessions.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

function isStalePendingApprovalFailure(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail !== "string") return false;
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request")
  );
}

export const makeSessionApprovalProjections = Effect.gen(function* () {
  const sessionRepository = yield* ProjectionThreadSessionRepository;
  const approvalRepository = yield* ProjectionPendingApprovalRepository;

  const threadSessions: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      if (event.type !== "thread.session-set") return;
      yield* sessionRepository.upsert({
        threadId: event.payload.threadId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

  const pendingApprovals: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.activity-appended": {
          const activity = event.payload.activity;
          if (
            activity.kind !== "approval.requested" &&
            activity.kind !== "approval.resolved" &&
            activity.kind !== "provider.approval.respond.failed"
          ) {
            return;
          }
          const requestId =
            extractActivityRequestId(activity.payload) ?? event.metadata.requestId ?? null;
          if (requestId === null) return;
          const existingRow = yield* approvalRepository.getByRequestId({ requestId });
          if (
            activity.kind === "approval.resolved" ||
            (activity.kind === "provider.approval.respond.failed" &&
              isStalePendingApprovalFailure(activity.payload))
          ) {
            const resolvedDecisionRaw =
              typeof activity.payload === "object" &&
              activity.payload !== null &&
              "decision" in activity.payload
                ? (activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* approvalRepository.upsert({
              requestId,
              threadId: Option.isSome(existingRow)
                ? existingRow.value.threadId
                : event.payload.threadId,
              turnId: Option.isSome(existingRow) ? existingRow.value.turnId : activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : activity.createdAt,
              resolvedAt: activity.createdAt,
            });
            return;
          }
          if (activity.kind !== "approval.requested") return;
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") return;
          yield* approvalRepository.upsert({
            requestId,
            threadId: event.payload.threadId,
            turnId: activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : activity.createdAt,
            resolvedAt: null,
          });
          return;
        }
        case "thread.approval-response-requested": {
          const existingRow = yield* approvalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* approvalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }
        default:
          return;
      }
    });

  return { threadSessions, pendingApprovals };
});
