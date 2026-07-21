// FILE: browser-manager/runtimeRegistry.ts
// Purpose: Own native and renderer WebContents runtimes and their view attachment.
// Layer: Desktop browser runtime

import { BrowserWindow, WebContentsView } from "electron";
import type { BrowserPanelBounds, ThreadId } from "@agent-group/contracts";

import {
  BROWSER_SESSION_PARTITION,
  type BrowserRuntimeEventCallbacks,
  type LiveTabRuntime,
  type NativeBrowserViewVisibility,
} from "./contracts";
import { configureRuntimeWebContents } from "./runtimeEvents";
import { browserBoundsSignature, buildRuntimeKey, syncThreadLastError } from "./state";
import type { BrowserStateStore } from "./state";

interface BrowserRuntimeRegistryCallbacks extends BrowserRuntimeEventCallbacks {
  clearTabSuspendTimer(threadId: ThreadId, tabId: string): void;
  clearPendingRuntimeSync(key: string): void;
  closeAllPopupWindows(): void;
}

export class BrowserRuntimeRegistry {
  private window: BrowserWindow | null = null;
  private activeThreadId: ThreadId | null = null;
  private activeBounds: BrowserPanelBounds | null = null;
  private activeBoundsThreadId: ThreadId | null = null;
  private attachedRuntimeKey: string | null = null;
  private attachedBoundsSignature: string | null = null;
  private readonly runtimes = new Map<string, LiveTabRuntime>();
  private readonly runtimeLastActiveAtByKey = new Map<string, number>();

  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly callbacks: BrowserRuntimeRegistryCallbacks,
  ) {}

  setWindow(window: BrowserWindow | null): void {
    this.window = window;
    if (window) {
      const bounds = this.activeThreadId
        ? this.getVisibleBoundsForThread(this.activeThreadId)
        : null;
      if (this.activeThreadId && bounds) {
        this.callbacks.attachActiveTab(this.activeThreadId, bounds);
      }
      return;
    }

    this.detachAttachedRuntime();
    this.destroyAllRuntimes();
    this.callbacks.closeAllPopupWindows();
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  dispose(): void {
    this.detachAttachedRuntime();
    this.destroyAllRuntimes();
    this.runtimeLastActiveAtByKey.clear();
    this.window = null;
    this.activeThreadId = null;
    this.activeBounds = null;
    this.activeBoundsThreadId = null;
    this.attachedBoundsSignature = null;
  }

  getActiveThreadId(): ThreadId | null {
    return this.activeThreadId;
  }

  setActiveThreadId(threadId: ThreadId | null): void {
    this.activeThreadId = threadId;
  }

  isActiveThread(threadId: ThreadId): boolean {
    return this.activeThreadId === threadId;
  }

  setActiveBounds(threadId: ThreadId, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      this.clearActiveBoundsForThread(threadId);
      return;
    }
    this.activeBounds = bounds;
    this.activeBoundsThreadId = threadId;
  }

  clearActiveBoundsForThread(threadId: ThreadId): void {
    if (this.activeBoundsThreadId !== threadId) return;
    this.activeBounds = null;
    this.activeBoundsThreadId = null;
  }

  getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null {
    return this.activeBoundsThreadId === threadId ? this.activeBounds : null;
  }

  getActiveBounds(): BrowserPanelBounds | null {
    return this.activeBounds;
  }

  getActiveBoundsThreadId(): ThreadId | null {
    return this.activeBoundsThreadId;
  }

  getAttachedRuntimeKey(): string | null {
    return this.attachedRuntimeKey;
  }

  getAttachedBoundsSignature(): string | null {
    return this.attachedBoundsSignature;
  }

  clearAttachedRuntimeIdentity(): void {
    this.attachedRuntimeKey = null;
    this.attachedBoundsSignature = null;
  }

  get(threadId: ThreadId, tabId: string): LiveTabRuntime | undefined {
    return this.runtimes.get(buildRuntimeKey(threadId, tabId));
  }

  getByKey(key: string): LiveTabRuntime | undefined {
    return this.runtimes.get(key);
  }

  has(threadId: ThreadId, tabId: string): boolean {
    return this.runtimes.has(buildRuntimeKey(threadId, tabId));
  }

  get size(): number {
    return this.runtimes.size;
  }

  values(): IterableIterator<LiveTabRuntime> {
    return this.runtimes.values();
  }

  getLastActiveAt(key: string): number {
    return this.runtimeLastActiveAtByKey.get(key) ?? 0;
  }

  attachRuntime(runtime: LiveTabRuntime, bounds: BrowserPanelBounds): void {
    const window = this.window;
    if (!window) return;

    const nextBoundsSignature = browserBoundsSignature(bounds);
    this.runtimeLastActiveAtByKey.set(runtime.key, Date.now());
    if (!runtime.ownsWebContents) {
      if (this.attachedRuntimeKey && this.attachedRuntimeKey !== runtime.key) {
        this.detachAttachedRuntime();
      }
      this.attachedRuntimeKey = runtime.key;
      this.attachedBoundsSignature = nextBoundsSignature;
      this.callbacks.updatePopupWindowsForThread(runtime.threadId);
      return;
    }
    if (!runtime.view) {
      this.attachedRuntimeKey = runtime.key;
      this.attachedBoundsSignature = nextBoundsSignature;
      this.callbacks.updatePopupWindowsForThread(runtime.threadId);
      return;
    }
    if (this.attachedRuntimeKey === runtime.key) {
      this.setRuntimeViewHidden(runtime, false);
      this.bringRuntimeViewToFront(runtime);
      if (this.attachedBoundsSignature === nextBoundsSignature) return;
      runtime.view.setBounds(bounds);
      this.attachedBoundsSignature = nextBoundsSignature;
      this.callbacks.updatePopupWindowsForThread(runtime.threadId);
      return;
    }

    this.detachAttachedRuntime();
    this.setRuntimeViewHidden(runtime, false);
    this.bringRuntimeViewToFront(runtime);
    runtime.view.setBounds(bounds);
    this.attachedRuntimeKey = runtime.key;
    this.attachedBoundsSignature = nextBoundsSignature;
    this.callbacks.updatePopupWindowsForThread(runtime.threadId);
  }

  private bringRuntimeViewToFront(runtime: LiveTabRuntime): void {
    if (!this.window || !runtime.view) return;
    try {
      this.window.contentView.removeChildView(runtime.view);
    } catch {
      // Adding the view below is the desired state when it was not attached.
    }
    this.window.contentView.addChildView(runtime.view);
  }

  detachAttachedRuntime(): void {
    if (!this.window || !this.attachedRuntimeKey) {
      this.attachedRuntimeKey = null;
      this.attachedBoundsSignature = null;
      return;
    }
    const runtime = this.runtimes.get(this.attachedRuntimeKey);
    if (runtime?.view) {
      this.setRuntimeViewHidden(runtime, true);
      this.window.contentView.removeChildView(runtime.view);
    }
    this.attachedRuntimeKey = null;
    this.attachedBoundsSignature = null;
  }

  private setRuntimeViewHidden(runtime: LiveTabRuntime, hidden: boolean): void {
    if (!runtime.view) return;
    const nativeView = runtime.view as typeof runtime.view & NativeBrowserViewVisibility;
    nativeView.setVisible?.(!hidden);
    if (hidden) runtime.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  ensureLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const key = buildRuntimeKey(threadId, tabId);
    this.callbacks.clearTabSuspendTimer(threadId, tabId);
    const existing = this.runtimes.get(key);
    if (existing) {
      if (existing.webContents.isDestroyed()) this.destroyRuntime(threadId, tabId);
      else return existing;
    }

    const runtime = this.createLiveRuntime(threadId, tabId);
    this.runtimes.set(key, runtime);
    const state = this.stateStore.ensureWorkspace(threadId);
    const tab = this.stateStore.getTab(state, tabId);
    if (tab) {
      const didChange = tab.status !== "live" || tab.lastError !== null;
      tab.status = "live";
      tab.lastError = null;
      syncThreadLastError(state);
      if (didChange) this.stateStore.markThreadStateChanged(threadId);
    }
    return runtime;
  }

  registerRendererRuntime(runtime: LiveTabRuntime): void {
    configureRuntimeWebContents(runtime, this.stateStore, this.callbacks);
    this.runtimes.set(runtime.key, runtime);
  }

  private createLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const runtime: LiveTabRuntime = {
      key: buildRuntimeKey(threadId, tabId),
      threadId,
      tabId,
      webContents: view.webContents,
      view,
      ownsWebContents: true,
      listenerDisposers: [],
    };
    configureRuntimeWebContents(runtime, this.stateStore, this.callbacks);
    return runtime;
  }

  findRendererRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.ownsWebContents && runtime.webContents.id === webContentsId) return runtime;
    }
    return null;
  }

  destroyThreadRuntimes(threadId: ThreadId): void {
    const state = this.stateStore.states.get(threadId);
    if (!state) return;
    for (const tab of state.tabs) this.destroyRuntime(threadId, tab.id);
  }

  destroyAllRuntimes(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime.threadId, runtime.tabId);
    }
  }

  destroyRuntime(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    this.callbacks.clearTabSuspendTimer(threadId, tabId);
    this.callbacks.clearPendingRuntimeSync(key);
    this.runtimeLastActiveAtByKey.delete(key);
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    if (this.attachedRuntimeKey === key) this.detachAttachedRuntime();
    this.runtimes.delete(key);
    const webContents = runtime.webContents;
    for (const disposeListener of runtime.listenerDisposers.splice(0)) disposeListener();
    if (!webContents.isDestroyed()) {
      if (webContents.debugger.isAttached()) {
        try {
          webContents.debugger.detach();
        } catch {
          // Ignore stale-debugger cleanup noise while the runtime is torn down.
        }
      }
      if (runtime.ownsWebContents) webContents.close({ waitForBeforeUnload: false });
    }
  }

  getTrackedProcessIds(): number[] {
    const processIds = new Set<number>();
    for (const runtime of this.runtimes.values()) {
      if (!runtime.webContents.isDestroyed()) processIds.add(runtime.webContents.getProcessId());
    }
    return [...processIds];
  }
}
