// FILE: useDeferredSecondaryChrome.ts
// Purpose: Defer expensive secondary chat chrome by one frame after thread changes.
// Layer: Web chat presentation controller

import type { ThreadId } from "@agent-group/contracts";
import { useEffect, useState } from "react";

export function useDeferredSecondaryChrome(input: {
  activeThreadId: ThreadId | null;
  routeThreadId: ThreadId;
  defer: boolean;
}) {
  const threadId = input.activeThreadId ?? input.routeThreadId;
  const [state, setState] = useState(() => ({ threadId, ready: true }));
  const ready = !input.defer || (state.threadId === threadId && state.ready);

  useEffect(() => {
    if (!input.defer) {
      setState((current) =>
        current.threadId === threadId && current.ready ? current : { threadId, ready: true },
      );
      return;
    }
    setState({ threadId, ready: false });
    const frame = window.requestAnimationFrame(() => {
      setState({ threadId, ready: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [input.defer, threadId]);

  return { threadId, ready };
}
