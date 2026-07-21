import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type readline from "node:readline";

import type { ApprovalRequestId, ProviderSession, TurnId } from "@agent-group/contracts";

import type {
  PendingCodexApprovalRequest,
  PendingCodexUserInputRequest,
} from "../codexCollaborationRouting.ts";

interface PendingRequest {
  readonly method: string;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export type CodexPlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "team"
  | "business"
  | "enterprise"
  | "edu"
  | "unknown";

export interface CodexAccountSnapshot {
  readonly type: "apiKey" | "chatgpt" | "unknown";
  readonly planType: CodexPlanType | null;
  readonly sparkEnabled: boolean;
}

export interface CodexSessionApprovalOverride {
  readonly approvalPolicy: "never";
  readonly sandboxPolicy: { readonly type: "dangerFullAccess" };
}

export interface CodexSessionContext {
  session: ProviderSession;
  account: CodexAccountSnapshot;
  child: ChildProcessWithoutNullStreams;
  output: readline.Interface;
  pending: Map<string, PendingRequest>;
  pendingApprovals: Map<ApprovalRequestId, PendingCodexApprovalRequest>;
  pendingUserInputs: Map<ApprovalRequestId, PendingCodexUserInputRequest>;
  sessionApprovalOverride?: CodexSessionApprovalOverride;
  collabReceiverTurns: Map<string, TurnId>;
  collabReceiverParents: Map<string, string>;
  reviewTurnIds: Set<TurnId>;
  nextRequestId: number;
  stopping: boolean;
  stopPromise?: Promise<void>;
  teardownRetry?: () => Promise<unknown>;
  discovery?: boolean;
}
