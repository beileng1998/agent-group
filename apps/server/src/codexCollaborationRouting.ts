import type {
  ApprovalRequestId,
  ProviderItemId,
  ProviderRequestKind,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";

export interface PendingCodexApprovalRequest {
  readonly requestId: ApprovalRequestId;
  readonly jsonRpcId: string | number;
  readonly method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/fileRead/requestApproval";
  readonly requestKind: ProviderRequestKind;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly parentTurnId?: TurnId;
  readonly itemId?: ProviderItemId;
  readonly providerThreadId?: string;
  readonly providerParentThreadId?: string;
}

export interface PendingCodexUserInputRequest {
  readonly requestId: ApprovalRequestId;
  readonly jsonRpcId: string | number;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly parentTurnId?: TurnId;
  readonly itemId?: ProviderItemId;
  readonly providerThreadId?: string;
  readonly providerParentThreadId?: string;
}

export interface CodexCollaborationRoute {
  readonly parentTurnId?: TurnId;
  readonly providerThreadId?: string;
  readonly providerParentThreadId?: string;
  readonly isChildConversation: boolean;
}

interface ResolveCodexCollaborationRouteInput {
  readonly parentTurnId?: TurnId;
  readonly providerThreadId?: string;
  readonly mappedProviderParentThreadId?: string;
  readonly activeProviderThreadId?: string;
  readonly hasActiveParentTurn: boolean;
}

export function resolveCodexCollaborationRoute(
  input: ResolveCodexCollaborationRouteInput,
): CodexCollaborationRoute {
  const isUnmappedChildConversation =
    input.mappedProviderParentThreadId === undefined &&
    input.hasActiveParentTurn &&
    input.providerThreadId !== undefined &&
    input.activeProviderThreadId !== undefined &&
    input.providerThreadId !== input.activeProviderThreadId;
  const providerParentThreadId =
    input.mappedProviderParentThreadId ??
    (isUnmappedChildConversation ? input.activeProviderThreadId : undefined);

  return {
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    ...(input.providerThreadId ? { providerThreadId: input.providerThreadId } : {}),
    ...(providerParentThreadId ? { providerParentThreadId } : {}),
    isChildConversation:
      input.parentTurnId !== undefined ||
      providerParentThreadId !== undefined ||
      isUnmappedChildConversation,
  };
}
