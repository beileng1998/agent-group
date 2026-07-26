import type { TerminalAgentAttachedEvent, TerminalAgentEvent } from "@agent-group/contracts";
import type { Terminal, IDisposable } from "@xterm/xterm";

import { readNativeApi } from "../../nativeApi";
import { toastManager } from "../ui/toast";
import { ManagedTerminalInputQueue } from "./managedTerminalInputQueue";
import { ManagedTerminalOutputPump } from "./managedTerminalOutputPump";
import {
  buildManagedTerminalSnapshotAnsi,
  classifyManagedTerminalOutput,
  managedTerminalEventThreadId,
  splitManagedTerminalInput,
} from "./managedTerminalPresentation";
import { ManagedTerminalSnapshotGuard } from "./managedTerminalSnapshotGuard";
import { isTerminalQueryReply } from "./terminalQueryReply";

export type ManagedTerminalConnectionStatus = "connecting" | "ready" | "reconnecting" | "error";

type AttachmentFence = {
  revision: number;
  generation: string;
  acceptedOutputSequence: number;
};

export class ManagedAgentTerminalTransport {
  private readonly inputQueue: ManagedTerminalInputQueue;
  private readonly outputPump: ManagedTerminalOutputPump;
  private readonly snapshotGuard = new ManagedTerminalSnapshotGuard();
  private readonly disposables: IDisposable[] = [];
  private fence: AttachmentFence | null = null;
  private unsubscribe = () => {};
  private resubscribeTimer: number | null = null;
  private lastSentSize: { cols: number; rows: number } | null = null;
  private resyncPending = false;
  private disposed = false;
  status: ManagedTerminalConnectionStatus = "connecting";

  constructor(
    private readonly threadId: string,
    private readonly terminal: Terminal,
    private readonly onStatusChange: (status: ManagedTerminalConnectionStatus) => void,
    private readonly onReady: () => void,
  ) {
    this.inputQueue = new ManagedTerminalInputQueue((fence, data) => {
      const api = readNativeApi();
      if (!api?.terminalAgent) {
        return Promise.reject(new Error("Managed Agent Terminal is unavailable."));
      }
      return api.terminalAgent.write({
        threadId: this.threadId,
        revision: fence.revision,
        generation: fence.generation,
        data,
      });
    }, this.requestSnapshotResync);
    this.outputPump = new ManagedTerminalOutputPump(terminal, this.requestSnapshotResync);
    this.installInput();
    this.subscribe();
  }

  readonly retry = () => {
    this.snapshotGuard.retry();
    this.resyncPending = false;
    this.requestSnapshotResync();
  };

  resize(cols: number, rows: number): void {
    const api = readNativeApi();
    const fence = this.fence;
    if (
      !api?.terminalAgent ||
      !fence ||
      (this.lastSentSize?.cols === cols && this.lastSentSize.rows === rows)
    ) {
      return;
    }
    this.lastSentSize = { cols, rows };
    void api.terminalAgent
      .resize({
        threadId: this.threadId,
        revision: fence.revision,
        generation: fence.generation,
        cols,
        rows,
      })
      .catch(() => {
        if (this.lastSentSize?.cols === cols && this.lastSentSize.rows === rows) {
          this.lastSentSize = null;
        }
      });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.inputQueue.dispose();
    this.outputPump.dispose();
    if (this.resubscribeTimer !== null) {
      window.clearTimeout(this.resubscribeTimer);
    }
    for (const disposable of this.disposables) disposable.dispose();
  }

  private readonly setStatus = (status: ManagedTerminalConnectionStatus) => {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange(status);
  };

  private readonly requestSnapshotResync = () => {
    if (this.disposed || this.resyncPending) return;
    this.resyncPending = true;
    this.fence = null;
    this.inputQueue.setFence(null);
    this.outputPump.invalidate();
    this.terminal.blur();
    this.setStatus("reconnecting");
    this.unsubscribe();
    this.resubscribeTimer = window.setTimeout(() => {
      this.resubscribeTimer = null;
      this.subscribe();
    }, 0);
  };

  private subscribe(): void {
    if (this.disposed) return;
    const api = readNativeApi();
    if (!api?.terminalAgent) {
      this.setStatus("error");
      return;
    }
    try {
      this.unsubscribe = api.terminalAgent.subscribe(
        { threadId: this.threadId, mode: "terminal" },
        this.handleEvent,
      );
    } catch (error) {
      this.resyncPending = false;
      this.setStatus("error");
      toastManager.add({
        type: "error",
        title: "Terminal stream unavailable",
        description:
          error instanceof Error ? error.message : "The terminal stream could not be opened.",
      });
    }
  }

  private readonly handleEvent = (event: TerminalAgentEvent) => {
    if (this.disposed || managedTerminalEventThreadId(event) !== this.threadId) {
      return;
    }
    if (event.type === "state") {
      this.observeState(event);
      return;
    }
    if (event.type === "attached") {
      this.attachSnapshot(event);
      return;
    }
    if (event.type === "output" && this.fence) {
      const fence = this.fence;
      const decision = classifyManagedTerminalOutput({
        attachedRevision: fence.revision,
        attachedGeneration: fence.generation,
        outputSequence: fence.acceptedOutputSequence,
        revision: event.revision,
        generation: event.generation,
        seq: event.seq,
      });
      if (decision === "resync") {
        this.requestSnapshotResync();
      } else if (decision === "write" && this.outputPump.enqueue(event.data, () => undefined)) {
        fence.acceptedOutputSequence = event.seq;
      }
      return;
    }
    if (
      (event.type === "exited" || event.type === "error") &&
      this.fence?.revision === event.revision &&
      (event.type === "exited" ||
        event.generation === null ||
        this.fence.generation === event.generation)
    ) {
      this.fence = null;
      this.inputQueue.setFence(null);
      this.outputPump.invalidate();
      this.setStatus("error");
    }
  };

  private observeState(event: Extract<TerminalAgentEvent, { type: "state" }>) {
    const state = event.state;
    this.snapshotGuard.observeFence(
      state.authority === "terminal" && state.generation
        ? { revision: state.revision, generation: state.generation }
        : null,
    );
    if (
      state.authority !== "terminal" ||
      state.status === "starting" ||
      state.status === "stopping" ||
      state.status === "stopped" ||
      state.status === "exited" ||
      state.status === "unsupported" ||
      (this.fence &&
        (state.revision !== this.fence.revision || state.generation !== this.fence.generation))
    ) {
      this.fence = null;
      this.inputQueue.setFence(null);
      this.outputPump.invalidate();
      this.setStatus(
        state.status === "exited" || state.status === "unsupported" ? "error" : "connecting",
      );
    }
  }

  private attachSnapshot(event: TerminalAgentAttachedEvent): void {
    const restoredAnsi = `\u001bc${buildManagedTerminalSnapshotAnsi(event.snapshot)}`;
    const decision = this.snapshotGuard.evaluate(
      { revision: event.revision, generation: event.generation },
      restoredAnsi,
    );
    if (decision !== "accept") {
      this.fence = null;
      this.inputQueue.setFence(null);
      this.outputPump.invalidate();
      this.setStatus("error");
      if (decision === "oversized") {
        toastManager.add({
          type: "error",
          title: "Terminal snapshot is too large",
          description: "Restart the terminal to create a fresh rendering epoch.",
        });
      }
      return;
    }
    this.fence = {
      revision: event.revision,
      generation: event.generation,
      acceptedOutputSequence: event.snapshot.outputSequence,
    };
    this.inputQueue.setFence({
      revision: event.revision,
      generation: event.generation,
    });
    this.lastSentSize = null;
    this.resyncPending = false;
    try {
      this.terminal.resize(event.snapshot.cols, event.snapshot.rows);
    } catch {
      this.requestSnapshotResync();
      return;
    }
    if (
      !this.outputPump.reset(restoredAnsi, () => {
        this.setStatus("ready");
        this.onReady();
      })
    ) {
      this.requestSnapshotResync();
    }
  }

  private installInput(): void {
    let keyboardData: string | null = null;
    this.disposables.push(
      this.terminal.onKey(({ key }) => {
        keyboardData = key;
        queueMicrotask(() => {
          if (keyboardData === key) keyboardData = null;
        });
      }),
      this.terminal.onData((data) => {
        if (this.status !== "ready") return;
        const cameFromKeyboard = keyboardData === data;
        if (cameFromKeyboard) keyboardData = null;
        if (!cameFromKeyboard && isTerminalQueryReply(data)) return;
        for (const chunk of splitManagedTerminalInput(data)) {
          if (!this.inputQueue.enqueue(chunk)) {
            this.requestSnapshotResync();
            break;
          }
        }
      }),
    );
  }
}
