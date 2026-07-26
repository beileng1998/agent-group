// FILE: terminalHostStartupBuffer.ts
// Purpose: Preserve PTY events while durable ownership is captured.
// Layer: Server terminal host lifecycle

import type { PtyExitEvent, PtyProcess } from "../terminal/Services/PTY";

const STARTUP_BUFFER_MAX_BYTES = 16 * 1024 * 1024;
const STARTUP_BUFFER_MAX_EVENTS = 4_096;

type StartupEvent =
  | { readonly type: "data"; readonly data: string }
  | { readonly type: "exit"; readonly event: PtyExitEvent };

export class TerminalHostStartupBufferOverflowError extends Error {
  constructor() {
    super("Managed terminal startup output exceeded its buffer limit.");
    this.name = "TerminalHostStartupBufferOverflowError";
  }
}

export class TerminalHostStartupBuffer {
  private readonly events: StartupEvent[] = [];
  private bufferedBytes = 0;
  private failure: Error | null = null;
  private live = false;
  private discarded = false;

  constructor(
    private readonly pty: PtyProcess,
    private readonly onLiveData: (data: string) => void,
    private readonly onLiveExit: (event: PtyExitEvent) => void,
  ) {}

  readonly onData = (data: string): void => {
    if (this.discarded) return;
    if (this.live) {
      this.onLiveData(data);
      return;
    }
    const bytes = Buffer.byteLength(data);
    if (
      this.failure !== null ||
      this.events.length >= STARTUP_BUFFER_MAX_EVENTS ||
      this.bufferedBytes + bytes > STARTUP_BUFFER_MAX_BYTES
    ) {
      this.fail();
      return;
    }
    this.events.push({ type: "data", data });
    this.bufferedBytes += bytes;
  };

  readonly onExit = (event: PtyExitEvent): void => {
    if (this.discarded) return;
    if (this.live) {
      this.onLiveExit(event);
      return;
    }
    if (this.failure !== null || this.events.length >= STARTUP_BUFFER_MAX_EVENTS) {
      this.fail();
      return;
    }
    this.events.push({ type: "exit", event });
  };

  promote(): void {
    if (this.failure !== null) throw this.failure;
    const events = this.events.splice(0);
    this.bufferedBytes = 0;
    this.live = true;
    for (const event of events) {
      if (event.type === "data") this.onLiveData(event.data);
      else this.onLiveExit(event.event);
    }
  }

  discard(): void {
    this.discarded = true;
    this.events.length = 0;
    this.bufferedBytes = 0;
  }

  private fail(): void {
    if (this.failure !== null) return;
    this.failure = new TerminalHostStartupBufferOverflowError();
    this.events.length = 0;
    this.bufferedBytes = 0;
    try {
      this.pty.pause();
    } catch {
      // The verified teardown path below remains authoritative.
    }
  }
}
