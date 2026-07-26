import type { TerminalHostSession } from "./TerminalHostTypes";

/**
 * Wait for a PTY exit without retaining a listener after the grace deadline.
 * Teardown can be retried, so timeout cleanup is part of the ownership bound.
 */
export function waitForTerminalSessionExit(
  session: TerminalHostSession,
  timeoutMs: number,
): Promise<boolean> {
  if (!session.isAlive) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: () => void;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      session.exitListeners.delete(listener);
      resolve(exited);
    };
    listener = () => finish(true);
    session.exitListeners.add(listener);
    timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    if (!session.isAlive) finish(true);
  });
}
