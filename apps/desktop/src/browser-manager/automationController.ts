// FILE: browser-manager/automationController.ts
// Purpose: Own browser screenshots, clipboard actions, and CDP browser-use commands.
// Layer: Desktop browser runtime

import { clipboard, nativeImage } from "electron";
import type {
  BrowserCaptureScreenshotResult,
  BrowserCopyLinkEvent,
  BrowserExecuteCdpInput,
  BrowserTabInput,
  ThreadId,
} from "@agent-group/contracts";
import {
  normalizeBrowserUrlInput as normalizeUrlInput,
  resolveCopyableBrowserTabUrl,
} from "@agent-group/shared/browserSession";

import { SUSPENDED_TAB_STATUS, type BrowserUseCdpEvent, type LiveTabRuntime } from "./contracts";
import type { BrowserPageLoader } from "./pageLoading";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import type { BrowserRuntimeStateSync } from "./runtimeStateSync";
import { screenshotFileNameForUrl, syncThreadLastError } from "./state";
import type { BrowserStateStore } from "./state";
import type { BrowserSuspensionPolicy } from "./suspensionPolicy";
import type { BrowserWorkspaceController } from "./workspaceController";

export class BrowserAutomationController {
  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
    private readonly runtimeSync: BrowserRuntimeStateSync,
    private readonly suspension: BrowserSuspensionPolicy,
    private readonly pageLoader: BrowserPageLoader,
    private readonly workspace: BrowserWorkspaceController,
  ) {}

  private async captureScreenshotPng(input: BrowserTabInput): Promise<{
    name: string;
    pngBytes: Buffer;
  }> {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }

    this.suspension.resumeThread(input.threadId);
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.runtimes.ensureLiveRuntime(input.threadId, tab.id);
    const webContents = runtime.webContents;
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = webContents.getURL();
    const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
    if (bounds) this.workspace.attachActiveTab(input.threadId, bounds);

    if (wasSuspended || currentUrl.length === 0 || currentUrl !== expectedUrl) {
      await this.pageLoader.load(input.threadId, tab.id, { runtime });
    } else {
      this.runtimeSync.queue(input.threadId, tab.id);
    }

    const pngBytes = (await webContents.capturePage()).toPNG();
    if (pngBytes.byteLength === 0) {
      throw new Error("Couldn't capture a browser screenshot.");
    }
    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      pngBytes,
    };
  }

  async captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    const { name, pngBytes } = await this.captureScreenshotPng(input);
    return {
      name,
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      bytes: Uint8Array.from(pngBytes),
    };
  }

  copyLink(input: BrowserTabInput): void {
    this.copyTabLink(input.threadId, input.tabId);
  }

  async copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    const { pngBytes } = await this.captureScreenshotPng(input);
    const image = nativeImage.createFromBuffer(pngBytes);
    if (image.isEmpty()) {
      throw new Error("Couldn't copy a browser screenshot to the clipboard.");
    }
    clipboard.writeImage(image);
  }

  async executeCdp(input: BrowserExecuteCdpInput): Promise<unknown> {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }

    this.suspension.resumeThread(input.threadId);
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.runtimes.ensureLiveRuntime(input.threadId, tab.id);
    const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
    if (bounds) this.workspace.attachActiveTab(input.threadId, bounds);

    if (wasSuspended) {
      await this.pageLoader.load(input.threadId, tab.id, { force: true, runtime });
    } else {
      this.runtimeSync.queue(input.threadId, tab.id);
    }

    if (!runtime.webContents.debugger.isAttached()) runtime.webContents.debugger.attach("1.3");
    try {
      return await runtime.webContents.debugger.sendCommand(input.method, input.params ?? {});
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`CDP ${input.method} failed: ${error.message}`);
      }
      throw error;
    }
  }

  async attachBrowserUseTab(input: BrowserTabInput): Promise<void> {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }

    this.suspension.resumeThread(input.threadId);
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.runtimes.ensureLiveRuntime(input.threadId, tab.id);
    const bounds = this.runtimes.getActiveBounds();
    if (bounds && this.runtimes.getActiveBoundsThreadId() === input.threadId) {
      this.workspace.activateThread(input.threadId, bounds);
    }

    if (wasSuspended) {
      await this.pageLoader.load(input.threadId, tab.id, { force: true, runtime });
    } else {
      this.runtimeSync.queue(input.threadId, tab.id);
    }
    if (!runtime.webContents.debugger.isAttached()) runtime.webContents.debugger.attach("1.3");
  }

  subscribeToCdpEvents(
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ): () => void {
    const runtime = this.runtimes.get(input.threadId, input.tabId);
    if (!runtime) return () => {};
    const handleMessage = (_event: Electron.Event, method: string, params?: unknown) => {
      listener({ method, ...(params !== undefined ? { params } : {}) });
    };
    runtime.webContents.debugger.on("message", handleMessage);
    return () => {
      runtime.webContents.debugger.removeListener("message", handleMessage);
    };
  }

  copyTabLink(threadId: ThreadId, tabId: string): void {
    const runtime = this.runtimes.get(threadId, tabId);
    const url = this.resolveCopyableTabUrl(threadId, tabId, runtime);
    if (!url) return;
    clipboard.writeText(url);
    const event: BrowserCopyLinkEvent = { threadId, url };
    this.stateStore.emitCopyLink(event);
  }

  private resolveCopyableTabUrl(
    threadId: ThreadId,
    tabId: string,
    runtime: LiveTabRuntime | undefined,
  ): string | null {
    const state = this.stateStore.states.get(threadId);
    const tab = state ? this.stateStore.getTab(state, tabId) : null;
    const liveUrl =
      runtime && !runtime.webContents.isDestroyed() ? runtime.webContents.getURL() : null;
    return resolveCopyableBrowserTabUrl(tab, liveUrl);
  }
}
