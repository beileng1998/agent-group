// FILE: appSnapManager.ts
// Purpose: Exposes the stable AppSnap desktop API over helper and pending-capture owners.
// Layer: Desktop main-process service facade

import * as ChildProcess from "node:child_process";

import type { DesktopAppSnapCapture, DesktopAppSnapState } from "@agent-group/contracts";

import type {
  DesktopAppSnapManagerOptions,
  ResolvedDesktopAppSnapManagerOptions,
} from "./app-snap-manager/contracts";
import { AppSnapHelperLifecycle } from "./app-snap-manager/helperLifecycle";
import { AppSnapPendingCaptureStore } from "./app-snap-manager/pendingCaptureStore";

export type { DesktopAppSnapManagerOptions } from "./app-snap-manager/contracts";
export {
  desktopAppSnapPlatform,
  isPathInsideDirectory,
  parseAppSnapHelperMessage,
} from "./app-snap-manager/helperProtocol";

export class DesktopAppSnapManager {
  readonly #helper: AppSnapHelperLifecycle;
  readonly #pendingCaptures: AppSnapPendingCaptureStore;

  constructor(options: DesktopAppSnapManagerOptions) {
    const resolvedOptions: ResolvedDesktopAppSnapManagerOptions = {
      ...options,
      now: options.now ?? (() => new Date()),
      spawn: options.spawn ?? ChildProcess.spawn,
    };
    this.#pendingCaptures = new AppSnapPendingCaptureStore(resolvedOptions);
    this.#helper = new AppSnapHelperLifecycle(resolvedOptions, (message) =>
      this.#pendingCaptures.enqueue(message),
    );
  }

  getState(): DesktopAppSnapState {
    return this.#helper.getState();
  }

  async refreshState(): Promise<DesktopAppSnapState> {
    return await this.#helper.refreshState();
  }

  async setEnabled(enabled: boolean): Promise<DesktopAppSnapState> {
    return await this.#helper.setEnabled(enabled);
  }

  async requestPermissions(): Promise<DesktopAppSnapState> {
    return await this.#helper.requestPermissions();
  }

  async listPendingCaptures(): Promise<DesktopAppSnapCapture[]> {
    return await this.#pendingCaptures.list();
  }

  async acknowledgeCapture(captureId: string): Promise<void> {
    await this.#pendingCaptures.acknowledge(captureId);
  }

  dispose(): void {
    this.#helper.dispose();
    this.#pendingCaptures.clear();
  }
}
