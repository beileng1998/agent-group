import { TERMINAL_AGENT_SNAPSHOT_MAX_BYTES } from "@agent-group/contracts";

export function managedTerminalUtf8Bytes(data: string): number {
  return new TextEncoder().encode(data).byteLength;
}

export interface ManagedTerminalWriteTarget {
  write(data: string, callback?: () => void): void;
}

interface PendingWrite {
  readonly data: string;
  readonly bytes: number;
  readonly epoch: number;
  readonly onParsed: () => void;
}

/**
 * Keeps at most one write in xterm's parser and bounds the data waiting behind
 * it. Screen interpretation remains entirely owned by xterm.
 */
export class ManagedTerminalOutputPump {
  private readonly queue: PendingWrite[] = [];
  private active: PendingWrite | null = null;
  private epoch = 0;
  private pendingBytes = 0;
  private overflowed = false;

  constructor(
    private readonly target: ManagedTerminalWriteTarget,
    private readonly onOverflow: () => void,
    private readonly maxPendingBytes = TERMINAL_AGENT_SNAPSHOT_MAX_BYTES,
  ) {}

  reset(data: string, onParsed: () => void): boolean {
    this.epoch += 1;
    for (const pending of this.queue) {
      this.pendingBytes -= pending.bytes;
    }
    this.queue.length = 0;
    this.overflowed = false;
    if (data.length === 0) {
      onParsed();
      return true;
    }
    const bytes = managedTerminalUtf8Bytes(data);
    if (this.pendingBytes + bytes > this.maxPendingBytes) {
      this.invalidate();
      this.onOverflow();
      return false;
    }
    this.pendingBytes += bytes;
    this.queue.push({ data, bytes, epoch: this.epoch, onParsed });
    return this.flush();
  }

  enqueue(data: string, onParsed: () => void): boolean {
    if (this.overflowed) return false;
    return this.enqueueForEpoch(data, this.epoch, onParsed);
  }

  invalidate(): void {
    this.epoch += 1;
    for (const pending of this.queue) {
      this.pendingBytes -= pending.bytes;
    }
    this.queue.length = 0;
    this.overflowed = true;
  }

  dispose(): void {
    this.invalidate();
  }

  private enqueueForEpoch(
    data: string,
    epoch: number,
    onParsed: () => void,
  ): boolean {
    if (data.length === 0) {
      onParsed();
      return true;
    }
    const bytes = managedTerminalUtf8Bytes(data);
    if (this.pendingBytes + bytes > this.maxPendingBytes) {
      this.invalidate();
      this.onOverflow();
      return false;
    }
    this.pendingBytes += bytes;
    this.queue.push({ data, bytes, epoch, onParsed });
    return this.flush();
  }

  private flush(): boolean {
    if (this.active || this.queue.length === 0) return true;
    const pending = this.queue.shift()!;
    this.active = pending;
    try {
      this.target.write(pending.data, () => {
        this.complete(pending);
      });
    } catch {
      this.active = null;
      this.pendingBytes -= pending.bytes;
      this.invalidate();
      this.onOverflow();
      return false;
    }
    return true;
  }

  private complete(pending: PendingWrite): void {
    if (this.active !== pending) return;
    this.active = null;
    this.pendingBytes -= pending.bytes;
    if (pending.epoch === this.epoch && !this.overflowed) {
      pending.onParsed();
    }
    this.flush();
  }
}
