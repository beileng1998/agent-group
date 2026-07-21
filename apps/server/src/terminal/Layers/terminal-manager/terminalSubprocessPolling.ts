import type { TerminalSessionState } from "../../Services/Manager";
import {
  captureProcessChildrenMap,
  inspectSubprocessActivity,
  isProviderSessionBusy,
  normalizeSubprocessActivity,
  type TerminalSubprocessChecker,
} from "./terminalSubprocessInspection";
import { toSessionKey } from "./terminalSessionValues";
import type { TerminalManagerLogger } from "./terminalManagerContracts";

const SUBPROCESS_IDLE_POLL_MULTIPLIER = 8;

export class TerminalSubprocessPolling {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private currentDelayMs = 0;

  constructor(
    private readonly options: {
      sessions: Map<string, TerminalSessionState>;
      checker: TerminalSubprocessChecker;
      useDefaultChecker: boolean;
      intervalMs: number;
      logger: TerminalManagerLogger;
      emitActivity: (session: TerminalSessionState) => void;
    },
  ) {}

  update(): void {
    const hasRunning = [...this.options.sessions.values()].some(
      (session) => session.status === "running" && session.pid !== null,
    );
    if (hasRunning) this.ensure();
    else this.stop();
  }

  private ensure(): void {
    if (this.timer || this.inFlight) return;
    void this.runCycle();
  }

  private desiredInterval(now: number): number {
    for (const session of this.options.sessions.values()) {
      if (session.status !== "running" || session.pid === null) continue;
      if (session.hasRunningSubprocess || isProviderSessionBusy(session, now)) {
        return this.options.intervalMs;
      }
    }
    return this.options.intervalMs * SUBPROCESS_IDLE_POLL_MULTIPLIER;
  }

  private async runCycle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.poll();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const hasRunning = [...this.options.sessions.values()].some(
      (session) => session.status === "running" && session.pid !== null,
    );
    if (!hasRunning) {
      this.currentDelayMs = 0;
      return;
    }
    const delayMs = this.desiredInterval(Date.now());
    this.currentDelayMs = delayMs;
    const timer = setTimeout(() => void this.runCycle(), delayMs);
    timer.unref?.();
    this.timer = timer;
  }

  bump(): void {
    if (this.inFlight || !this.timer || this.currentDelayMs <= this.options.intervalMs) return;
    this.scheduleNext();
  }

  stop(): void {
    this.currentDelayMs = 0;
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.inFlight) return;
    const running = [...this.options.sessions.values()].filter(
      (session): session is TerminalSessionState & { pid: number } =>
        session.status === "running" && Number.isInteger(session.pid),
    );
    if (running.length === 0) {
      this.stop();
      return;
    }
    this.inFlight = true;
    const sharedChildrenMap =
      this.options.useDefaultChecker && process.platform !== "win32"
        ? await captureProcessChildrenMap()
        : null;
    try {
      await Promise.all(
        running.map(async (session) => {
          const terminalPid = session.pid;
          let hasRunningSubprocess = false;
          let shouldClearDetectedCliKind = false;
          try {
            const activity =
              sharedChildrenMap !== null
                ? inspectSubprocessActivity(terminalPid, sharedChildrenMap)
                : normalizeSubprocessActivity(await this.options.checker(terminalPid));
            const providerDescendantObserved =
              session.providerDescendantObserved ||
              (session.detectedCliKind !== null && activity.hasProviderDescendant);
            shouldClearDetectedCliKind =
              session.detectedCliKind !== null &&
              !activity.hasProviderDescendant &&
              (providerDescendantObserved || !isProviderSessionBusy(session, Date.now()));
            session.providerDescendantObserved = providerDescendantObserved;
            hasRunningSubprocess = session.managedAgentObserved
              ? session.managedAgentRunning || activity.hasNonProviderSubprocess
              : activity.hasProviderDescendant
                ? activity.hasNonProviderSubprocess || isProviderSessionBusy(session, Date.now())
                : activity.hasRunningSubprocess;
          } catch (error) {
            this.options.logger.warn("failed to check terminal subprocess activity", {
              threadId: session.threadId,
              terminalId: session.terminalId,
              terminalPid,
              error: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          const live = this.options.sessions.get(
            toSessionKey(session.threadId, session.terminalId),
          );
          if (!live || live.status !== "running" || live.pid !== terminalPid) return;
          const nextCliKind =
            shouldClearDetectedCliKind && live.detectedCliKind === session.detectedCliKind
              ? null
              : live.detectedCliKind;
          const nextProviderObserved =
            nextCliKind === null ? false : session.providerDescendantObserved;
          if (
            live.hasRunningSubprocess === hasRunningSubprocess &&
            live.detectedCliKind === nextCliKind &&
            live.providerDescendantObserved === nextProviderObserved
          ) {
            return;
          }
          live.hasRunningSubprocess = hasRunningSubprocess;
          live.detectedCliKind = nextCliKind;
          live.providerDescendantObserved = nextProviderObserved;
          live.updatedAt = new Date().toISOString();
          this.options.emitActivity(live);
        }),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
