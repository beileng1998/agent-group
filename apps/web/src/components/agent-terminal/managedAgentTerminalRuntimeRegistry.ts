import {
  ManagedAgentTerminalRuntime,
  type ManagedAgentTerminalRuntimeCallbacks,
} from "./managedAgentTerminalRuntime";

const MAX_PARKED_RUNTIMES = 4;

class ManagedAgentTerminalRuntimeRegistry {
  private readonly entries = new Map<string, ManagedAgentTerminalRuntime>();

  attach(
    threadId: string,
    container: HTMLDivElement,
    callbacks: ManagedAgentTerminalRuntimeCallbacks,
  ) {
    let runtime = this.entries.get(threadId);
    if (!runtime) {
      runtime = new ManagedAgentTerminalRuntime(threadId);
      this.entries.set(threadId, runtime);
    }
    return runtime.attach(container, callbacks);
  }

  detach(threadId: string, container: HTMLDivElement): void {
    this.entries.get(threadId)?.detach(container);
    this.evictExcessParkedRuntimes();
  }

  disposeThread(threadId: string): void {
    this.entries.get(threadId)?.dispose();
    this.entries.delete(threadId);
  }

  private evictExcessParkedRuntimes(): void {
    const parked = [...this.entries.values()]
      .filter((runtime) => runtime.isParked())
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    while (parked.length > MAX_PARKED_RUNTIMES) {
      const runtime = parked.shift()!;
      runtime.dispose();
      this.entries.delete(runtime.threadId);
    }
  }
}

export const managedAgentTerminalRuntimeRegistry = new ManagedAgentTerminalRuntimeRegistry();
