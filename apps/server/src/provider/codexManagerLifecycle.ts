export class CodexManagerLifecycleSupersededError extends Error {
  constructor() {
    super("Codex manager lifecycle changed before provider creation completed.");
    this.name = "CodexManagerLifecycleSupersededError";
  }
}

export class CodexManagerClosedError extends Error {
  constructor() {
    super("Codex manager is closed and cannot create provider processes.");
    this.name = "CodexManagerClosedError";
  }
}

export interface CodexManagerCreationLease {
  assertCurrent(): void;
}

class KeyedPromiseLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<A>(key: string, operation: () => Promise<A>): Promise<A> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all([...this.tails.values()].map((tail) => tail.catch(() => undefined)));
    }
  }
}

/** Serializes each Codex owner while making stopAll an epoch barrier across every owner. */
export class CodexManagerLifecycleCoordinator {
  private readonly lock = new KeyedPromiseLock();
  private epoch = 0;
  private stopAllInFlight: Promise<void> | null = null;
  private closeInFlight: Promise<void> | null = null;
  private closed = false;

  async runCreation<A>(
    key: string,
    operation: (lease: CodexManagerCreationLease) => Promise<A>,
  ): Promise<A> {
    if (this.closed) throw new CodexManagerClosedError();
    const barrier = this.stopAllInFlight;
    if (barrier) {
      await barrier;
      return this.runCreation(key, operation);
    }

    const epoch = this.epoch;
    return this.lock.run(key, async () => {
      const lease: CodexManagerCreationLease = {
        assertCurrent: () => {
          if (epoch !== this.epoch) throw new CodexManagerLifecycleSupersededError();
        },
      };
      lease.assertCurrent();
      return operation(lease);
    });
  }

  async runMutation<A>(key: string, operation: () => Promise<A>): Promise<A> {
    const barrier = this.stopAllInFlight;
    if (barrier) {
      await barrier;
      return this.runMutation(key, operation);
    }
    return this.lock.run(key, operation);
  }

  runStopAll(operation: () => Promise<void>): Promise<void> {
    if (this.closeInFlight) return this.closeInFlight;
    if (this.stopAllInFlight) return this.stopAllInFlight;
    this.epoch += 1;
    const stopping = this.stopAfterCurrentOwners(operation);
    this.stopAllInFlight = stopping;
    void stopping.then(
      () => this.clearStopAll(stopping),
      () => this.clearStopAll(stopping),
    );
    return stopping;
  }

  runClose(operation: () => Promise<void>): Promise<void> {
    if (this.closeInFlight) return this.closeInFlight;
    this.closed = true;
    const closing = this.runStopAll(operation);
    this.closeInFlight = closing;
    void closing.catch(() => {
      // Admission stays permanently closed, but a transient exit-proof failure may be retried.
      if (this.closeInFlight === closing) this.closeInFlight = null;
    });
    return closing;
  }

  private async stopAfterCurrentOwners(operation: () => Promise<void>): Promise<void> {
    const [stopped] = await Promise.allSettled([operation(), this.lock.waitForIdle()]);
    if (stopped.status === "rejected") throw stopped.reason;
  }

  private clearStopAll(stopping: Promise<void>): void {
    if (this.stopAllInFlight === stopping) this.stopAllInFlight = null;
  }
}
