import type { TerminalSessionState } from "../../Services/Manager";
import type { TerminalHistoryPersistence } from "./terminalHistoryPersistence";
import type { TerminalOutputFlow } from "./terminalOutputFlow";
import type { TerminalPtyLifecycle } from "./terminalPtyLifecycle";
import { toSessionKey } from "./terminalSessionValues";

export class TerminalSessionRegistry {
  readonly sessions = new Map<string, TerminalSessionState>();
  private readonly threadLocks = new Map<string, Promise<void>>();

  constructor(private readonly maxRetainedInactiveSessions: number) {}

  get(threadId: string, terminalId: string): TerminalSessionState | undefined {
    return this.sessions.get(toSessionKey(threadId, terminalId));
  }

  require(threadId: string, terminalId: string): TerminalSessionState {
    const session = this.get(threadId, terminalId);
    if (!session) {
      throw new Error(`Unknown terminal thread: ${threadId}, terminal: ${terminalId}`);
    }
    return session;
  }

  forThread(threadId: string): TerminalSessionState[] {
    return [...this.sessions.values()].filter((session) => session.threadId === threadId);
  }

  async withThreadLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.threadLocks.set(threadId, current);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.threadLocks.get(threadId) === current) this.threadLocks.delete(threadId);
    }
  }

  evictInactive(options: {
    output: TerminalOutputFlow;
    history: TerminalHistoryPersistence;
    lifecycle: TerminalPtyLifecycle;
  }): void {
    const inactive = [...this.sessions.values()].filter((session) => session.status !== "running");
    if (inactive.length <= this.maxRetainedInactiveSessions) return;
    inactive.sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.threadId.localeCompare(right.threadId) ||
        left.terminalId.localeCompare(right.terminalId),
    );
    for (const session of inactive.slice(0, inactive.length - this.maxRetainedInactiveSessions)) {
      options.output.flush(session);
      this.sessions.delete(toSessionKey(session.threadId, session.terminalId));
      options.history.persistEvicted(session);
      options.lifecycle.clearEscalation(session.process);
    }
  }

  clearLocks(): void {
    this.threadLocks.clear();
  }
}
