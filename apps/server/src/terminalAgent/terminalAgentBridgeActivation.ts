// FILE: terminalAgentBridgeActivation.ts
// Purpose: Gate hook handling on launch without losing cancellation.
// Layer: Managed terminal hook orchestration

import {
  resolveTerminalAgentBridgeOperation,
  type TerminalAgentBridgeHandler,
  type TerminalAgentBridgeOperation,
} from "./terminalAgentBridgeOperation";

function interruptedError(): Error {
  return new Error("Agent Terminal hook request was interrupted.");
}

function awaitActivation(activation: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.reject(interruptedError());
  return new Promise<boolean>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(interruptedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    void activation.then(
      (ready) => {
        signal.removeEventListener("abort", abort);
        resolve(ready);
      },
      (cause) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

export function gateTerminalAgentBridgeHandler(
  activation: Promise<boolean>,
  handler: TerminalAgentBridgeHandler,
): TerminalAgentBridgeHandler {
  return (request, requestSignal): TerminalAgentBridgeOperation => {
    const cancellation = new AbortController();
    const signal = AbortSignal.any([requestSignal, cancellation.signal]);
    let inner: TerminalAgentBridgeOperation | null = null;
    let cancelPromise: Promise<void> | null = null;

    const cancel = async (): Promise<void> => {
      cancellation.abort();
      if (inner?.cancel && cancelPromise === null) {
        cancelPromise = Promise.resolve().then(inner.cancel);
      }
      await cancelPromise;
    };
    const result = (async () => {
      const ready = await awaitActivation(activation, signal);
      if (!ready) throw new Error("Agent Terminal launch did not complete.");
      if (signal.aborted) throw interruptedError();
      inner = resolveTerminalAgentBridgeOperation(handler(request, signal));
      if (signal.aborted) {
        await cancel();
        throw interruptedError();
      }
      return await inner.result;
    })();
    return { result, cancel };
  };
}
