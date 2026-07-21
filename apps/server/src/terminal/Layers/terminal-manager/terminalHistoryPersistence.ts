import fs from "node:fs";
import path from "node:path";

import { DEFAULT_TERMINAL_ID } from "@agent-group/contracts";

import type { TerminalSessionState } from "../../Services/Manager";
import { capHistoryByLimits, type HistoryLimits } from "../../terminalHistory";
import {
  DEFAULT_PERSIST_DEBOUNCE_MS,
  type TerminalManagerLogger,
} from "./terminalManagerContracts";
import { sanitizePersistedTerminalHistory } from "./terminalHistorySanitizer";
import {
  legacySafeThreadId,
  toSafeTerminalId,
  toSafeThreadId,
  toSessionKey,
} from "./terminalSessionValues";

export class TerminalHistoryPersistence {
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingHistory = new Map<string, () => string>();
  private readonly persistedHistoryByKey = new Map<string, string>();
  private persistTempCounter = 0;

  constructor(
    private readonly options: {
      logsDir: string;
      limits: HistoryLimits;
      logger: TerminalManagerLogger;
      debounceMs?: number;
    },
  ) {}

  queue(session: TerminalSessionState): void {
    const key = toSessionKey(session.threadId, session.terminalId);
    this.pendingHistory.set(key, () => session.history.toString());
    this.schedule(session.threadId, session.terminalId);
  }

  async persist(threadId: string, terminalId: string, history: string): Promise<void> {
    const key = toSessionKey(threadId, terminalId);
    this.clearTimer(threadId, terminalId);
    this.pendingHistory.delete(key);
    await this.enqueueWrite(threadId, terminalId, history);
  }

  enqueueWrite(threadId: string, terminalId: string, history: string): Promise<void> {
    const key = toSessionKey(threadId, terminalId);
    const task = async () => {
      if (this.persistedHistoryByKey.get(key) === history) return;
      const finalPath = this.historyPath(threadId, terminalId);
      const tempPath = `${finalPath}.tmp-${process.pid}-${(this.persistTempCounter += 1)}`;
      try {
        await fs.promises.writeFile(tempPath, history, "utf8");
        await fs.promises.rename(tempPath, finalPath);
        this.persistedHistoryByKey.set(key, history);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const previous = this.persistQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        this.options.logger.warn("failed to persist terminal history", {
          threadId,
          terminalId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    this.persistQueues.set(key, next);
    const finalized = next.finally(() => {
      if (this.persistQueues.get(key) === next) this.persistQueues.delete(key);
      if (this.pendingHistory.has(key) && !this.persistTimers.has(key)) {
        this.schedule(threadId, terminalId);
      }
    });
    void finalized.catch(() => undefined);
    return finalized;
  }

  private schedule(threadId: string, terminalId: string): void {
    const key = toSessionKey(threadId, terminalId);
    if (this.persistTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(key);
      const materialize = this.pendingHistory.get(key);
      if (!materialize) return;
      this.pendingHistory.delete(key);
      void this.enqueueWrite(threadId, terminalId, materialize());
    }, this.options.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS);
    timer.unref?.();
    this.persistTimers.set(key, timer);
  }

  clearTimer(threadId: string, terminalId: string): void {
    const key = toSessionKey(threadId, terminalId);
    const timer = this.persistTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.persistTimers.delete(key);
  }

  discardPending(threadId: string, terminalId: string): void {
    this.pendingHistory.delete(toSessionKey(threadId, terminalId));
  }

  async read(threadId: string, terminalId: string): Promise<string> {
    const nextPath = this.historyPath(threadId, terminalId);
    const key = toSessionKey(threadId, terminalId);
    try {
      const raw = await fs.promises.readFile(nextPath, "utf8");
      const capped = capHistoryByLimits(sanitizePersistedTerminalHistory(raw), this.options.limits);
      if (capped !== raw) await fs.promises.writeFile(nextPath, capped, "utf8");
      this.persistedHistoryByKey.set(key, capped);
      return capped;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (terminalId !== DEFAULT_TERMINAL_ID) return "";

    const legacyPath = this.legacyHistoryPath(threadId);
    try {
      const raw = await fs.promises.readFile(legacyPath, "utf8");
      const capped = capHistoryByLimits(sanitizePersistedTerminalHistory(raw), this.options.limits);
      await fs.promises.writeFile(nextPath, capped, "utf8");
      this.persistedHistoryByKey.set(key, capped);
      try {
        await fs.promises.rm(legacyPath, { force: true });
      } catch (error) {
        this.options.logger.warn("failed to remove legacy terminal history", {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return capped;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.persistedHistoryByKey.set(key, "");
        return "";
      }
      throw error;
    }
  }

  async delete(threadId: string, terminalId: string): Promise<void> {
    this.persistedHistoryByKey.delete(toSessionKey(threadId, terminalId));
    const deletions = [fs.promises.rm(this.historyPath(threadId, terminalId), { force: true })];
    if (terminalId === DEFAULT_TERMINAL_ID) {
      deletions.push(fs.promises.rm(this.legacyHistoryPath(threadId), { force: true }));
    }
    try {
      await Promise.all(deletions);
    } catch (error) {
      this.options.logger.warn("failed to delete terminal history", {
        threadId,
        terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async deleteAllForThread(threadId: string): Promise<void> {
    const threadPrefix = `${toSafeThreadId(threadId)}_`;
    for (const key of [...this.persistedHistoryByKey.keys()]) {
      if (key.startsWith(`${threadId}\u0000`)) this.persistedHistoryByKey.delete(key);
    }
    try {
      const entries = await fs.promises.readdir(this.options.logsDir, { withFileTypes: true });
      const removals = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter(
          (name) =>
            name === `${toSafeThreadId(threadId)}.log` ||
            name === `${legacySafeThreadId(threadId)}.log` ||
            name.startsWith(threadPrefix),
        )
        .map((name) => fs.promises.rm(path.join(this.options.logsDir, name), { force: true }));
      await Promise.all(removals);
    } catch (error) {
      this.options.logger.warn("failed to delete terminal histories for thread", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async flush(threadId: string, terminalId: string): Promise<void> {
    const key = toSessionKey(threadId, terminalId);
    this.clearTimer(threadId, terminalId);
    while (true) {
      const materialize = this.pendingHistory.get(key);
      if (materialize) {
        this.pendingHistory.delete(key);
        await this.enqueueWrite(threadId, terminalId, materialize());
      }
      const pending = this.persistQueues.get(key);
      if (!pending) return;
      await pending.catch(() => undefined);
    }
  }

  persistEvicted(session: TerminalSessionState): void {
    const key = toSessionKey(session.threadId, session.terminalId);
    this.clearTimer(session.threadId, session.terminalId);
    this.pendingHistory.delete(key);
    void this.enqueueWrite(
      session.threadId,
      session.terminalId,
      session.history.toString(),
    ).finally(() => this.persistedHistoryByKey.delete(key));
  }

  dispose(): void {
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    this.pendingHistory.clear();
    this.persistQueues.clear();
  }

  private historyPath(threadId: string, terminalId: string): string {
    const threadPart = toSafeThreadId(threadId);
    const filename =
      terminalId === DEFAULT_TERMINAL_ID
        ? `${threadPart}.log`
        : `${threadPart}_${toSafeTerminalId(terminalId)}.log`;
    return path.join(this.options.logsDir, filename);
  }

  private legacyHistoryPath(threadId: string): string {
    return path.join(this.options.logsDir, `${legacySafeThreadId(threadId)}.log`);
  }
}
