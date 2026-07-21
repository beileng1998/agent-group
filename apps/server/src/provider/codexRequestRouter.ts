import { randomUUID } from "node:crypto";

import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  ProviderRequestKind,
  type ProviderUserInputAnswers,
  ThreadId,
} from "@agent-group/contracts";

import { type PendingCodexApprovalRequest } from "../codexCollaborationRouting.ts";
import {
  readRouteFields,
  resolveCollaborationRoute as resolveManagerCollaborationRoute,
} from "./codexCollaborationRoutingState.ts";
import {
  CODEX_ALWAYS_ALLOW_SESSION_TURN_OVERRIDES,
  toCodexUserInputAnswers,
} from "./codexManagerProtocol.ts";
import type { CodexJsonRpcRequest as JsonRpcRequest } from "./codexJsonRpc.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";

export interface CodexRequestRouterDependencies {
  readonly requireSession: (threadId: ThreadId) => CodexSessionContext;
  readonly writeMessage: (context: CodexSessionContext, message: unknown) => void;
  readonly emitEvent: (event: ProviderEvent) => void;
}

export class CodexRequestRouter {
  constructor(private readonly dependencies: CodexRequestRouterDependencies) {}

  private requireSession(threadId: ThreadId): CodexSessionContext {
    return this.dependencies.requireSession(threadId);
  }

  private writeMessage(context: CodexSessionContext, message: unknown): void {
    this.dependencies.writeMessage(context, message);
  }

  private emitEvent(event: ProviderEvent): void {
    this.dependencies.emitEvent(event);
  }

  private resolveApprovalRequest(
    context: CodexSessionContext,
    pendingRequest: PendingCodexApprovalRequest,
    decision: ProviderApprovalDecision,
  ): void {
    this.writeMessage(context, {
      id: pendingRequest.jsonRpcId,
      result: {
        decision,
      },
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/requestApproval/decision",
      turnId: pendingRequest.turnId,
      parentTurnId: pendingRequest.parentTurnId,
      itemId: pendingRequest.itemId,
      providerThreadId: pendingRequest.providerThreadId,
      providerParentThreadId: pendingRequest.providerParentThreadId,
      requestId: pendingRequest.requestId,
      requestKind: pendingRequest.requestKind,
      payload: {
        requestId: pendingRequest.requestId,
        requestKind: pendingRequest.requestKind,
        decision,
      },
    });
  }

  private resolveRemainingSessionApprovalRequests(context: CodexSessionContext): void {
    const remainingRequests = Array.from(context.pendingApprovals.values());
    context.pendingApprovals.clear();
    for (const pendingRequest of remainingRequests) {
      this.resolveApprovalRequest(context, pendingRequest, "acceptForSession");
    }
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const pendingRequest = context.pendingApprovals.get(requestId);
    if (!pendingRequest) {
      throw new Error(`Unknown pending approval request: ${requestId}`);
    }

    context.pendingApprovals.delete(requestId);
    if (decision === "acceptForSession") {
      context.sessionApprovalOverride = CODEX_ALWAYS_ALLOW_SESSION_TURN_OVERRIDES;
    }
    this.resolveApprovalRequest(context, pendingRequest, decision);
    if (decision === "acceptForSession") {
      this.resolveRemainingSessionApprovalRequests(context);
    }
  }

  async respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const pendingRequest = context.pendingUserInputs.get(requestId);
    if (!pendingRequest) {
      throw new Error(`Unknown pending user input request: ${requestId}`);
    }

    context.pendingUserInputs.delete(requestId);
    const codexAnswers = toCodexUserInputAnswers(answers);
    this.writeMessage(context, {
      id: pendingRequest.jsonRpcId,
      result: {
        answers: codexAnswers,
      },
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/tool/requestUserInput/answered",
      turnId: pendingRequest.turnId,
      parentTurnId: pendingRequest.parentTurnId,
      itemId: pendingRequest.itemId,
      providerThreadId: pendingRequest.providerThreadId,
      providerParentThreadId: pendingRequest.providerParentThreadId,
      requestId: pendingRequest.requestId,
      payload: {
        requestId: pendingRequest.requestId,
        answers: codexAnswers,
      },
    });
  }

  handleServerRequest(context: CodexSessionContext, request: JsonRpcRequest): void {
    const rawRoute = readRouteFields(request.params);
    const {
      parentTurnId: childParentTurnId,
      providerThreadId,
      providerParentThreadId,
    } = resolveManagerCollaborationRoute(context, request.params);
    const requestKind = this.requestKindForMethod(request.method);
    let requestId: ApprovalRequestId | undefined;
    if (requestKind) {
      requestId = ApprovalRequestId.makeUnsafe(randomUUID());
      const pendingRequest: PendingCodexApprovalRequest = {
        requestId,
        jsonRpcId: request.id,
        method:
          requestKind === "command"
            ? "item/commandExecution/requestApproval"
            : requestKind === "file-read"
              ? "item/fileRead/requestApproval"
              : "item/fileChange/requestApproval",
        requestKind,
        threadId: context.session.threadId,
        ...(rawRoute.turnId ? { turnId: rawRoute.turnId } : {}),
        ...(childParentTurnId ? { parentTurnId: childParentTurnId } : {}),
        ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
        ...(providerThreadId ? { providerThreadId } : {}),
        ...(providerParentThreadId ? { providerParentThreadId } : {}),
      };
      if (context.sessionApprovalOverride) {
        this.resolveApprovalRequest(context, pendingRequest, "acceptForSession");
        return;
      }
      context.pendingApprovals.set(requestId, pendingRequest);
    }

    if (request.method === "item/tool/requestUserInput") {
      requestId = ApprovalRequestId.makeUnsafe(randomUUID());
      context.pendingUserInputs.set(requestId, {
        requestId,
        jsonRpcId: request.id,
        threadId: context.session.threadId,
        ...(rawRoute.turnId ? { turnId: rawRoute.turnId } : {}),
        ...(childParentTurnId ? { parentTurnId: childParentTurnId } : {}),
        ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
        ...(providerThreadId ? { providerThreadId } : {}),
        ...(providerParentThreadId ? { providerParentThreadId } : {}),
      });
    }

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "request",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: request.method,
      ...(rawRoute.turnId ? { turnId: rawRoute.turnId } : {}),
      ...(childParentTurnId ? { parentTurnId: childParentTurnId } : {}),
      ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
      ...(providerThreadId ? { providerThreadId } : {}),
      ...(providerParentThreadId ? { providerParentThreadId } : {}),
      requestId,
      requestKind,
      payload: request.params,
    });

    if (requestKind) {
      return;
    }

    if (request.method === "item/tool/requestUserInput") {
      return;
    }

    this.writeMessage(context, {
      id: request.id,
      error: {
        code: -32601,
        message: `Unsupported server request: ${request.method}`,
      },
    });
  }

  private requestKindForMethod(method: string): ProviderRequestKind | undefined {
    if (method === "item/commandExecution/requestApproval") {
      return "command";
    }

    if (method === "item/fileRead/requestApproval") {
      return "file-read";
    }

    if (method === "item/fileChange/requestApproval") {
      return "file-change";
    }

    return undefined;
  }
}
