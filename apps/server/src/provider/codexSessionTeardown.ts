import {
  ProviderProcessExitUnprovenError,
  teardownChildProcessTree,
  teardownProviderProcessTree,
} from "./supervisedProcessTeardown.ts";

interface PendingRequest {
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly reject: (error: Error) => void;
}

interface PendingRequestCollection {
  values(): IterableIterator<PendingRequest>;
  clear(): void;
}

interface ClearableCollection {
  clear(): void;
}

export interface CodexSessionTeardownContext {
  readonly session: { readonly threadId: string };
  readonly child: Parameters<typeof teardownChildProcessTree>[0];
  readonly output: { close(): void };
  readonly pending: PendingRequestCollection;
  readonly pendingApprovals: ClearableCollection;
  readonly pendingUserInputs: ClearableCollection;
  stopping: boolean;
  stopPromise?: Promise<void>;
  teardownRetry?: () => Promise<unknown>;
}

export type ProviderProcessTreeTeardown = typeof teardownProviderProcessTree;

/** Keeps one teardown in flight and resolves only after the owned process tree proves exit. */
export function stopCodexSessionContext(input: {
  readonly context: CodexSessionTeardownContext;
  readonly pendingError: Error;
  readonly teardownProcessTree?: ProviderProcessTreeTeardown;
  readonly onExitProven: () => void;
}): Promise<void> {
  const { context } = input;
  if (context.stopPromise) return context.stopPromise;

  context.stopping = true;
  for (const pending of context.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(input.pendingError);
  }
  context.pending.clear();
  context.pendingApprovals.clear();
  context.pendingUserInputs.clear();
  context.output.close();

  let safeToRetry = false;
  const teardown = context.teardownRetry
    ? context.teardownRetry()
    : teardownChildProcessTree(
        context.child,
        input.teardownProcessTree ?? teardownProviderProcessTree,
      );
  const stopPromise = teardown
    .catch((cause) => {
      safeToRetry = cause instanceof ProviderProcessExitUnprovenError && cause.safeToRetry;
      if (cause instanceof ProviderProcessExitUnprovenError && cause.retry) {
        context.teardownRetry = cause.retry;
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Failed to prove Codex app-server process-tree exit for '${context.session.threadId}': ${detail}`,
        { cause },
      );
    })
    .then(() => {
      delete context.teardownRetry;
      input.onExitProven();
    });
  // Pre-signal capture failures may recapture safely. Post-signal proof retries carry a closure
  // over the original captured identities, so neither path can target a newly observed tree.
  context.stopPromise = stopPromise;
  void stopPromise.catch(() => {
    if (safeToRetry && context.stopPromise === stopPromise) delete context.stopPromise;
  });
  return stopPromise;
}
