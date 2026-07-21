// FILE: browser-manager/suspensionPolicy.ts
// Purpose: Own inactive-tab and hidden-thread suspension timers and budgets.
// Layer: Desktop browser runtime

import type { ThreadId } from "@agent-group/contracts";

import {
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS,
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS,
  BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD,
  BROWSER_THREAD_SUSPEND_DELAY_MS,
  SUSPENDED_TAB_STATUS,
} from "./contracts";
import type { BrowserPageLoader } from "./pageLoading";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import {
  buildRuntimeKey,
  suspendTabState,
  syncTabStateFromRuntime,
  syncThreadLastError,
} from "./state";
import type { BrowserStateStore } from "./state";

export class BrowserSuspensionPolicy {
  private readonly tabSuspendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly suspendTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
    private readonly pageLoader: BrowserPageLoader,
  ) {}

  dispose(): void {
    for (const timer of this.suspendTimers.values()) clearTimeout(timer);
    this.suspendTimers.clear();
    for (const timer of this.tabSuspendTimers.values()) clearTimeout(timer);
    this.tabSuspendTimers.clear();
  }

  resumeThread(threadId: ThreadId): void {
    const state = this.stateStore.ensureWorkspace(threadId);
    if (!state.open) return;

    this.clearThreadSuspendTimer(threadId);
    const activeTab = this.stateStore.getActiveTab(state);
    let didChange = this.suspendInactiveTabs(threadId, activeTab?.id ?? null);
    for (const tab of state.tabs) {
      if (tab.id !== activeTab?.id) continue;
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
      const runtime = this.runtimes.ensureLiveRuntime(threadId, tab.id);
      if (wasSuspended) {
        void this.pageLoader.load(threadId, tab.id, { force: true, runtime });
      } else {
        didChange = syncTabStateFromRuntime(state, tab, runtime.webContents) || didChange;
      }
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      this.stateStore.markThreadStateChanged(threadId);
      this.stateStore.emitState(threadId);
    }
  }

  suspendInactiveTabs(threadId: ThreadId, activeTabId: string | null): boolean {
    const state = this.stateStore.states.get(threadId);
    if (!state) return false;

    let didChange = false;
    const inactiveRuntimeTabIds = state.tabs
      .filter((tab) => tab.id !== activeTabId)
      .filter((tab) => this.runtimes.has(threadId, tab.id))
      .sort((left, right) => {
        const leftKey = buildRuntimeKey(threadId, left.id);
        const rightKey = buildRuntimeKey(threadId, right.id);
        return this.runtimes.getLastActiveAt(rightKey) - this.runtimes.getLastActiveAt(leftKey);
      });
    const warmRuntimeTabIds = new Set(
      inactiveRuntimeTabIds
        .slice(0, BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD)
        .map((tab) => tab.id),
    );

    for (const tab of state.tabs) {
      if (tab.id === activeTabId) {
        this.clearTabSuspendTimer(threadId, tab.id);
        continue;
      }
      const runtime = this.runtimes.get(threadId, tab.id);
      if (runtime) {
        if (warmRuntimeTabIds.has(tab.id)) {
          this.scheduleInactiveTabSuspend(threadId, tab.id);
          continue;
        }
        this.stateStore.perfCounters.inactiveTabBudgetEvictions += 1;
        this.runtimes.destroyRuntime(threadId, tab.id);
        didChange = suspendTabState(tab) || didChange;
        continue;
      }
      didChange = suspendTabState(tab) || didChange;
    }
    return didChange;
  }

  scheduleThreadSuspend(threadId: ThreadId): void {
    const state = this.stateStore.states.get(threadId);
    if (!state?.open || this.runtimes.isActiveThread(threadId)) return;

    this.clearThreadSuspendTimer(threadId);
    const timer = setTimeout(() => {
      this.suspendThread(threadId);
      this.suspendTimers.delete(threadId);
    }, BROWSER_THREAD_SUSPEND_DELAY_MS);
    timer.unref();
    this.suspendTimers.set(threadId, timer);
  }

  private suspendThread(threadId: ThreadId): void {
    const state = this.stateStore.states.get(threadId);
    if (!state || this.runtimes.isActiveThread(threadId)) return;

    let didChange = false;
    for (const tab of state.tabs) {
      this.runtimes.destroyRuntime(threadId, tab.id);
      didChange = suspendTabState(tab) || didChange;
    }
    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      this.stateStore.markThreadStateChanged(threadId);
      this.stateStore.emitState(threadId);
    }
  }

  clearThreadSuspendTimer(threadId: ThreadId): void {
    const existing = this.suspendTimers.get(threadId);
    if (!existing) return;
    clearTimeout(existing);
    this.suspendTimers.delete(threadId);
  }

  private scheduleInactiveTabSuspend(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    if (this.tabSuspendTimers.has(key)) return;

    this.stateStore.perfCounters.inactiveTabSuspendScheduled += 1;
    const timer = setTimeout(() => {
      this.tabSuspendTimers.delete(key);
      const state = this.stateStore.states.get(threadId);
      const tab = state ? this.stateStore.getTab(state, tabId) : null;
      if (!state || !tab) return;
      this.runtimes.destroyRuntime(threadId, tabId);
      const didChange = suspendTabState(tab) || syncThreadLastError(state);
      if (didChange) {
        this.stateStore.markThreadStateChanged(threadId);
        this.stateStore.emitState(threadId);
      }
    }, this.resolveInactiveTabSuspendDelay(threadId));
    timer.unref();
    this.tabSuspendTimers.set(key, timer);
  }

  clearTabSuspendTimer(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = this.tabSuspendTimers.get(key);
    if (!existing) return;
    clearTimeout(existing);
    this.tabSuspendTimers.delete(key);
    this.stateStore.perfCounters.inactiveTabSuspendCancelled += 1;
  }

  countWarmInactiveRuntimes(): number {
    let count = 0;
    for (const [key] of this.tabSuspendTimers) {
      if (this.runtimes.getByKey(key)) count += 1;
    }
    return count;
  }

  private resolveInactiveTabSuspendDelay(threadId: ThreadId): number {
    const threadRuntimeCount = [...this.runtimes.values()].filter(
      (runtime) => runtime.threadId === threadId,
    ).length;
    if (
      threadRuntimeCount > BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD + 1 ||
      this.runtimes.size > 4
    ) {
      return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS;
    }
    return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS;
  }
}
