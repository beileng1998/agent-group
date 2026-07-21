import type { OrchestrationEvent, ThreadId } from "@agent-group/contracts";

export type ProviderQueuedTurnPayload = Extract<
  OrchestrationEvent,
  { type: "thread.turn-queued" }
>["payload"];

/** Owns queue admission markers so Reactor handlers do not coordinate raw Maps and Sets. */
export class ProviderTurnQueue {
  private readonly queuedByThread = new Map<string, ProviderQueuedTurnPayload[]>();
  private readonly editResendKeys = new Set<string>();
  private readonly drainingThreads = new Set<string>();
  private readonly pendingDispatchThreads = new Set<string>();

  enqueue(payload: ProviderQueuedTurnPayload): void {
    const existing = this.queuedByThread.get(payload.threadId) ?? [];
    if (payload.dispatchMode === "steer") existing.unshift(payload);
    else existing.push(payload);
    this.queuedByThread.set(payload.threadId, existing);
  }

  dequeue(threadId: ThreadId): ProviderQueuedTurnPayload | null {
    const existing = this.queuedByThread.get(threadId);
    if (!existing || existing.length === 0) return null;
    const next = existing.shift() ?? null;
    if (existing.length === 0) this.queuedByThread.delete(threadId);
    else this.queuedByThread.set(threadId, existing);
    return next;
  }

  remove(threadId: ThreadId, messageId: string): boolean {
    const existing = this.queuedByThread.get(threadId);
    if (!existing || existing.length === 0) return false;
    const next = existing.filter((payload) => payload.messageId !== messageId);
    if (next.length === existing.length) return false;
    if (next.length === 0) this.queuedByThread.delete(threadId);
    else this.queuedByThread.set(threadId, next);
    return true;
  }

  has(threadId: ThreadId, messageId: string): boolean {
    return (
      this.queuedByThread.get(threadId)?.some((payload) => payload.messageId === messageId) ?? false
    );
  }

  deleteQueuedTurns(threadId: ThreadId): void {
    this.queuedByThread.delete(threadId);
  }

  tryBeginDrain(threadId: ThreadId): boolean {
    if (this.drainingThreads.has(threadId) || this.pendingDispatchThreads.has(threadId)) {
      return false;
    }
    this.drainingThreads.add(threadId);
    return true;
  }

  finishDrain(threadId: ThreadId): void {
    this.drainingThreads.delete(threadId);
  }

  markDispatchPending(threadId: ThreadId): void {
    this.pendingDispatchThreads.add(threadId);
  }

  clearDispatchPending(threadId: ThreadId): void {
    this.pendingDispatchThreads.delete(threadId);
  }

  editResendKey(threadId: ThreadId, messageId: string): string {
    return `${threadId}:${messageId}`;
  }

  trackEditResend(threadId: ThreadId, messageId: string): void {
    this.editResendKeys.add(this.editResendKey(threadId, messageId));
  }

  completeEditResend(key: string): void {
    this.editResendKeys.delete(key);
  }

  clearEditResends(threadId: ThreadId): void {
    const prefix = `${threadId}:`;
    for (const key of this.editResendKeys) {
      if (key.startsWith(prefix)) this.editResendKeys.delete(key);
    }
  }

  clearThread(threadId: ThreadId): void {
    this.deleteQueuedTurns(threadId);
    this.clearEditResends(threadId);
    this.drainingThreads.delete(threadId);
    this.pendingDispatchThreads.delete(threadId);
  }
}
