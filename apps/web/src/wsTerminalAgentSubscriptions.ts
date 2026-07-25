import {
  type TerminalAgentEvent,
  type TerminalAgentSubscribeInput,
  WS_METHODS,
} from "@agent-group/contracts";

import type { WsSessionHandle } from "./wsTransportSession";

type TerminalAgentListener = (event: TerminalAgentEvent) => void;

interface TerminalAgentSubscription {
  readonly key: string;
  readonly input: TerminalAgentSubscribeInput;
  readonly listener: TerminalAgentListener;
  streamEpoch: number;
}

export class WsTerminalAgentSubscriptions {
  private readonly subscriptions = new Map<string, TerminalAgentSubscription>();
  private nextSubscriptionId = 0;

  constructor(
    private readonly runtime: {
      readonly getSession: () => Promise<WsSessionHandle>;
      readonly startStream: (
        session: WsSessionHandle,
        key: string,
        stream: unknown,
        listener: TerminalAgentListener,
      ) => void;
      readonly stopStream: (key: string) => void;
    },
  ) {}

  subscribe(
    input: TerminalAgentSubscribeInput,
    listener: TerminalAgentListener,
  ): () => void {
    const key = `${this.streamKey(input.threadId)}:${++this.nextSubscriptionId}`;
    const subscription = { key, input, listener, streamEpoch: 0 };
    this.subscriptions.set(key, subscription);
    this.start(subscription);

    return () => {
      if (this.subscriptions.get(key) !== subscription) return;
      this.subscriptions.delete(key);
      this.runtime.stopStream(key);
    };
  }

  restore(session: WsSessionHandle): void {
    for (const subscription of this.subscriptions.values()) {
      this.runtime.stopStream(subscription.key);
      this.start(subscription, session);
    }
  }

  clear(): void {
    for (const key of this.subscriptions.keys()) {
      this.runtime.stopStream(key);
    }
    this.subscriptions.clear();
  }

  private start(
    subscription: TerminalAgentSubscription,
    restoredSession?: WsSessionHandle,
  ): void {
    const streamEpoch = ++subscription.streamEpoch;
    const startWithSession = (session: WsSessionHandle) => {
      if (
        this.subscriptions.get(subscription.key) !== subscription ||
        subscription.streamEpoch !== streamEpoch
      ) {
        return;
      }
      this.runtime.startStream(
        session,
        subscription.key,
        session.client[WS_METHODS.terminalAgentSubscribe](subscription.input),
        (event) => {
          if (
            this.subscriptions.get(subscription.key) !== subscription ||
            subscription.streamEpoch !== streamEpoch
          ) {
            return;
          }
          try {
            subscription.listener(event);
          } catch {
            // A detached view must not break the terminal stream.
          }
        },
      );
    };

    if (restoredSession) {
      startWithSession(restoredSession);
    } else {
      void this.runtime.getSession().then(startWithSession).catch(() => undefined);
    }
  }

  private streamKey(threadId: string): string {
    return `terminal.agent:${threadId}`;
  }
}
