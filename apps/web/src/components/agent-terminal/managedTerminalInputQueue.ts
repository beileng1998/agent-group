import { managedTerminalUtf8Bytes } from "./managedTerminalOutputPump";

export interface ManagedTerminalInputFence {
  readonly revision: number;
  readonly generation: string;
}

interface PendingInput {
  readonly data: string;
  readonly bytes: number;
  readonly epoch: number;
  readonly fence: ManagedTerminalInputFence;
}

const DEFAULT_MAX_PENDING_INPUT_BYTES = 1024 * 1024;

function sameFence(
  left: ManagedTerminalInputFence | null,
  right: ManagedTerminalInputFence | null,
): boolean {
  return (
    left?.revision === right?.revision &&
    left?.generation === right?.generation
  );
}

export class ManagedTerminalInputQueue {
  private readonly queue: PendingInput[] = [];
  private active: PendingInput | null = null;
  private fence: ManagedTerminalInputFence | null = null;
  private epoch = 0;
  private pendingBytes = 0;
  private overflowNotified = false;
  private disposed = false;

  constructor(
    private readonly send: (
      fence: ManagedTerminalInputFence,
      data: string,
    ) => Promise<void>,
    private readonly onOverflow: () => void,
    private readonly maxPendingBytes = DEFAULT_MAX_PENDING_INPUT_BYTES,
  ) {}

  setFence(fence: ManagedTerminalInputFence | null): void {
    if (sameFence(this.fence, fence)) return;
    this.fence = fence ? { ...fence } : null;
    this.epoch += 1;
    for (const pending of this.queue) this.pendingBytes -= pending.bytes;
    this.queue.length = 0;
    this.updateOverflowState();
  }

  enqueue(data: string): boolean {
    if (this.disposed || this.fence === null || data.length === 0) return false;
    const bytes = managedTerminalUtf8Bytes(data);
    if (this.pendingBytes + bytes > this.maxPendingBytes) {
      if (!this.overflowNotified) {
        this.overflowNotified = true;
        this.onOverflow();
      }
      return false;
    }
    this.pendingBytes += bytes;
    this.queue.push({
      data,
      bytes,
      epoch: this.epoch,
      fence: this.fence,
    });
    this.flush();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.setFence(null);
  }

  private flush(): void {
    if (this.disposed || this.active || this.queue.length === 0) return;
    const pending = this.queue.shift()!;
    this.active = pending;
    void Promise.resolve()
      .then(() => {
        if (
          this.disposed ||
          pending.epoch !== this.epoch ||
          !sameFence(this.fence, pending.fence)
        ) {
          return;
        }
        return this.send(pending.fence, pending.data);
      })
      .catch(() => {
        if (
          !this.disposed &&
          pending.epoch === this.epoch &&
          sameFence(this.fence, pending.fence)
        ) {
          this.setFence(null);
          this.onOverflow();
        }
      })
      .finally(() => {
        if (this.active !== pending) return;
        this.active = null;
        this.pendingBytes -= pending.bytes;
        this.updateOverflowState();
        this.flush();
      });
  }

  private updateOverflowState(): void {
    if (this.pendingBytes < this.maxPendingBytes / 2) {
      this.overflowNotified = false;
    }
  }
}
