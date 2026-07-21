import type { ProviderRuntimeEvent, TurnId } from "@agent-group/contracts";

export type ProviderQueueDrainEvent = Extract<
  ProviderRuntimeEvent,
  { type: "turn.completed" | "turn.aborted" }
>;

export interface PendingContextBootstrapAttempt {
  turnId?: TurnId;
  terminalEvent?: ProviderQueueDrainEvent;
  readonly clearSidechat: boolean;
  readonly clearPriorTranscript: boolean;
}

export interface PendingAgentGroupTurnAttempt {
  turnId?: TurnId;
  terminalEvent?: ProviderQueueDrainEvent;
}

/** Owns transcript-bootstrap flags and in-flight terminal reconciliation. */
export class ProviderTurnBootstrapState {
  private readonly sidechatThreads = new Set<string>();
  private readonly freshSessionThreads = new Set<string>();
  private readonly rollbackThreads = new Set<string>();
  private readonly suppressedNextStartThreads = new Set<string>();
  private readonly contextAttempts = new Map<string, PendingContextBootstrapAttempt>();
  private readonly agentGroupAttempts = new Map<string, PendingAgentGroupTurnAttempt>();

  registerSidechat(threadId: string): void {
    this.sidechatThreads.add(threadId);
  }

  registerFreshSession(threadId: string): void {
    this.freshSessionThreads.add(threadId);
  }

  registerRollback(threadId: string): void {
    this.rollbackThreads.add(threadId);
  }

  hasSidechat(threadId: string): boolean {
    return this.sidechatThreads.has(threadId);
  }

  hasPendingPriorTranscript(threadId: string): boolean {
    return this.freshSessionThreads.has(threadId) || this.rollbackThreads.has(threadId);
  }

  suppressNextStart(threadId: string): void {
    this.suppressedNextStartThreads.add(threadId);
  }

  isNextStartSuppressed(threadId: string): boolean {
    return this.suppressedNextStartThreads.has(threadId);
  }

  clearNextStartSuppression(threadId: string): void {
    this.suppressedNextStartThreads.delete(threadId);
  }

  clearSidechat(threadId: string): void {
    this.sidechatThreads.delete(threadId);
  }

  clearPriorTranscript(threadId: string): void {
    this.freshSessionThreads.delete(threadId);
    this.rollbackThreads.delete(threadId);
    this.sidechatThreads.delete(threadId);
  }

  clearContext(threadId: string): void {
    this.clearPriorTranscript(threadId);
    this.contextAttempts.delete(threadId);
  }

  setContextAttempt(threadId: string, attempt: PendingContextBootstrapAttempt): void {
    this.contextAttempts.set(threadId, attempt);
  }

  isCurrentContextAttempt(threadId: string, attempt: PendingContextBootstrapAttempt): boolean {
    return this.contextAttempts.get(threadId) === attempt;
  }

  removeContextAttempt(threadId: string): void {
    this.contextAttempts.delete(threadId);
  }

  completeContextAttempt(
    threadId: string,
    attempt: PendingContextBootstrapAttempt,
    event: ProviderQueueDrainEvent,
  ): void {
    if (event.type !== "turn.completed" || event.payload.state !== "completed") return;
    if (attempt.clearSidechat) this.clearSidechat(threadId);
    if (attempt.clearPriorTranscript) this.clearPriorTranscript(threadId);
  }

  observeContextTerminalEvent(event: ProviderQueueDrainEvent): void {
    const attempt = this.contextAttempts.get(event.threadId);
    if (!attempt) return;
    if (attempt.turnId === undefined) {
      attempt.terminalEvent = event;
      return;
    }
    if (attempt.turnId !== event.turnId) return;
    this.contextAttempts.delete(event.threadId);
    this.completeContextAttempt(event.threadId, attempt, event);
  }

  setAgentGroupAttempt(threadId: string, attempt: PendingAgentGroupTurnAttempt): void {
    this.agentGroupAttempts.set(threadId, attempt);
  }

  clearAgentGroupAttempt(threadId: string, attempt: PendingAgentGroupTurnAttempt): void {
    if (this.agentGroupAttempts.get(threadId) === attempt) {
      this.agentGroupAttempts.delete(threadId);
    }
  }

  resolveAgentGroupTerminalTurnId(event: ProviderQueueDrainEvent): TurnId | null | undefined {
    const attempt = this.agentGroupAttempts.get(event.threadId);
    if (!attempt) return event.turnId ?? null;
    if (attempt.turnId === undefined) {
      attempt.terminalEvent = event;
      return undefined;
    }
    if (event.turnId && event.turnId !== attempt.turnId) return event.turnId;
    this.agentGroupAttempts.delete(event.threadId);
    return event.turnId ?? attempt.turnId;
  }
}
