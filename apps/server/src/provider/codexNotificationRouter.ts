import { randomUUID } from "node:crypto";

import { EventId, type ProviderEvent, type ProviderSession, type TurnId } from "@agent-group/contracts";

import {
  rememberCollabReceiverTurns,
  readRouteFields,
  resolveCollaborationRoute as resolveManagerCollaborationRoute,
  shouldSuppressChildConversationNotification,
} from "./codexCollaborationRoutingState.ts";
import { isNonFatalCodexErrorMessage } from "../codexErrorClassification.ts";
import { log, normalizeCodexUserVisibleErrorMessage } from "./codexManagerProtocol.ts";
import type { CodexJsonRpcNotification as JsonRpcNotification } from "./codexJsonRpc.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readBoolean, readObject, readString } from "./codexJsonValues.ts";
import { normalizeProviderThreadId, toTurnId } from "./codexManagerValues.ts";
import { isExitedReviewModeNotification } from "./codexReviewValues.ts";

export interface CodexNotificationRouterDependencies {
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
  readonly emitEvent: (event: ProviderEvent) => void;
  readonly settleTrackedReview: (
    context: CodexSessionContext,
    input: { readonly completedTurnId?: TurnId; readonly reason: string },
  ) => void;
}

export class CodexNotificationRouter {
  constructor(private readonly dependencies: CodexNotificationRouterDependencies) {}

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  private emitEvent(event: ProviderEvent): void {
    this.dependencies.emitEvent(event);
  }

  private settleTrackedReview(
    context: CodexSessionContext,
    input: { readonly completedTurnId?: TurnId; readonly reason: string },
  ): void {
    this.dependencies.settleTrackedReview(context, input);
  }

  handleServerNotification(context: CodexSessionContext, notification: JsonRpcNotification): void {
    const rawRoute = readRouteFields(notification.params);
    rememberCollabReceiverTurns(context, notification.params, rawRoute.turnId);
    const {
      parentTurnId: childParentTurnId,
      providerThreadId,
      providerParentThreadId,
      isChildConversation,
    } = resolveManagerCollaborationRoute(context, notification.params);
    if (isChildConversation && shouldSuppressChildConversationNotification(notification.method)) {
      return;
    }
    const textDelta =
      notification.method === "item/agentMessage/delta"
        ? readString(notification.params, "delta")
        : undefined;

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: notification.method,
      ...(rawRoute.turnId ? { turnId: rawRoute.turnId } : {}),
      ...(childParentTurnId ? { parentTurnId: childParentTurnId } : {}),
      ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
      ...(providerThreadId ? { providerThreadId } : {}),
      ...(providerParentThreadId ? { providerParentThreadId } : {}),
      textDelta,
      payload: notification.params,
    });

    if (notification.method === "thread/started") {
      const startedThreadId = normalizeProviderThreadId(
        readString(readObject(notification.params)?.thread, "id"),
      );
      if (startedThreadId && !isChildConversation) {
        this.updateSession(context, {
          resumeCursor: { threadId: startedThreadId },
        });
      }
      return;
    }

    if (notification.method === "turn/started") {
      if (isChildConversation) {
        return;
      }
      const turnId = toTurnId(readString(readObject(notification.params)?.turn, "id"));
      if (
        turnId !== undefined &&
        context.session.activeTurnId !== undefined &&
        context.reviewTurnIds.has(context.session.activeTurnId)
      ) {
        context.reviewTurnIds.add(turnId);
        log.info("[codex-review] extending tracked review turn set on turn/started", {
          threadId: context.session.threadId,
          previousTurnId: context.session.activeTurnId,
          nextTurnId: turnId,
        });
      }
      this.updateSession(context, {
        status: "running",
        activeTurnId: turnId,
      });
      return;
    }

    if (notification.method === "turn/completed") {
      if (isChildConversation) {
        return;
      }
      context.collabReceiverTurns.clear();
      if (rawRoute.turnId) {
        context.reviewTurnIds.delete(rawRoute.turnId);
      }
      const turn = readObject(notification.params, "turn");
      const status = readString(turn, "status");
      const errorMessageRaw = readString(readObject(turn, "error"), "message");
      const errorMessage =
        errorMessageRaw !== undefined
          ? normalizeCodexUserVisibleErrorMessage(errorMessageRaw)
          : undefined;
      this.updateSession(context, {
        status: status === "failed" ? "error" : "ready",
        activeTurnId: undefined,
        lastError: errorMessage ?? context.session.lastError,
      });
      return;
    }

    if (notification.method === "turn/aborted") {
      if (isChildConversation) {
        return;
      }
      context.collabReceiverTurns.clear();
      if (rawRoute.turnId) {
        context.reviewTurnIds.delete(rawRoute.turnId);
      }
      this.updateSession(context, {
        status: "ready",
        activeTurnId: undefined,
        lastError: undefined,
      });
      return;
    }

    if (isExitedReviewModeNotification(notification)) {
      if (isChildConversation) {
        return;
      }
      const item = readObject(notification.params, "item");
      const reviewTurnId = toTurnId(readString(item, "id")) ?? rawRoute.turnId;
      const reviewTurnTracked =
        reviewTurnId !== undefined ? context.reviewTurnIds.has(reviewTurnId) : false;
      const activeTurnTracked =
        context.session.activeTurnId !== undefined &&
        context.reviewTurnIds.has(context.session.activeTurnId);
      log.info("[codex-review] exitedReviewMode notification", {
        threadId: context.session.threadId,
        reviewTurnId: reviewTurnId ?? null,
        activeTurnId: context.session.activeTurnId ?? null,
        reviewTurnTracked,
        activeTurnTracked,
      });
      if (
        reviewTurnId !== undefined &&
        context.session.activeTurnId !== undefined &&
        reviewTurnId !== context.session.activeTurnId &&
        !reviewTurnTracked &&
        !activeTurnTracked
      ) {
        log.info("[codex-review] exitedReviewMode ignored due to turn mismatch", {
          threadId: context.session.threadId,
          reviewTurnId,
          activeTurnId: context.session.activeTurnId,
        });
        return;
      }
      // `review/start` can emit the final review result via `exitedReviewMode`
      // before the terminal `turn/completed` notification arrives. If that
      // completion never shows up, settle the session here instead of leaving
      // native review stuck in "running" forever.
      log.info("[codex-review] settling review from exitedReviewMode notification", {
        threadId: context.session.threadId,
        reviewTurnId: reviewTurnId ?? null,
      });
      this.settleTrackedReview(
        context,
        reviewTurnId !== undefined
          ? {
              completedTurnId: reviewTurnId,
              reason: "review exited via exitedReviewMode",
            }
          : {
              reason: "review exited via exitedReviewMode",
            },
      );
      return;
    }

    if (notification.method === "error") {
      if (isChildConversation) {
        return;
      }
      const rawMessage = readString(readObject(notification.params)?.error, "message");
      const message =
        rawMessage !== undefined ? normalizeCodexUserVisibleErrorMessage(rawMessage) : undefined;
      const willRetry = readBoolean(notification.params, "willRetry");
      const isNonFatalWarning =
        message !== undefined && !willRetry && isNonFatalCodexErrorMessage(message);

      if (willRetry) {
        log.warn("codex request failed; retrying", {
          threadId: context.session.threadId,
          turnId: rawRoute.turnId ?? context.session.activeTurnId,
          message: message ?? "Provider request failed.",
        });
        this.updateSession(context, {
          status: "running",
        });
        return;
      }

      if (isNonFatalWarning) {
        return;
      }

      this.updateSession(context, {
        status: "error",
        lastError: message ?? context.session.lastError,
      });
    }
  }
}
