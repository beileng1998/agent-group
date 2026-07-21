// FILE: useBrowserRuntimeSession.ts
// Purpose: Owns browser runtime wake-up, workspace lifecycle, and action errors.
// Layer: Browser panel controller

import type { NativeApi, ThreadBrowserState, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

export type BrowserActionRunner = <T>(action: () => Promise<T>) => Promise<T | null>;

export interface BrowserRuntimeSessionController {
  workspaceReady: boolean;
  runtimeReady: boolean;
  localError: string | null;
  setLocalError: Dispatch<SetStateAction<string | null>>;
  requestLiveRuntime: () => void;
  ensureLiveRuntime: () => boolean;
  runBrowserAction: BrowserActionRunner;
}

function formatBrowserActionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return "Couldn't complete that browser action.";
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null;
  }
  return "Couldn't complete that browser action.";
}

export function useBrowserRuntimeSession(input: {
  api: NativeApi | undefined;
  threadId: ThreadId;
  isLiveRuntime: boolean;
  onRequestLive?: (() => void) | undefined;
  upsertThreadState: (state: ThreadBrowserState) => void;
}): BrowserRuntimeSessionController {
  const { api, isLiveRuntime, onRequestLive, threadId, upsertThreadState } = input;
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const requestLiveRuntime = useCallback(() => {
    onRequestLive?.();
  }, [onRequestLive]);

  const ensureLiveRuntime = useCallback(() => {
    if (isLiveRuntime) {
      return true;
    }
    requestLiveRuntime();
    return false;
  }, [isLiveRuntime, requestLiveRuntime]);

  const runBrowserAction = useCallback<BrowserActionRunner>(async (action) => {
    try {
      const result = await action();
      setLocalError(null);
      return result;
    } catch (error) {
      setLocalError(formatBrowserActionError(error));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    return api.browser.onState((state) => {
      upsertThreadState(state);
    });
  }, [api, isLiveRuntime, upsertThreadState]);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    let cancelled = false;
    setWorkspaceReady(false);
    setLocalError(null);

    void runBrowserAction(() => api.browser.open({ threadId })).then((state) => {
      if (cancelled) {
        return;
      }
      if (!state) {
        setWorkspaceReady(true);
        return;
      }
      upsertThreadState(state);
      setWorkspaceReady(true);
    });

    return () => {
      cancelled = true;
      void api.browser.hide({ threadId });
    };
  }, [api, isLiveRuntime, runBrowserAction, threadId, upsertThreadState]);

  return {
    workspaceReady,
    runtimeReady: isLiveRuntime ? workspaceReady : true,
    localError,
    setLocalError,
    requestLiveRuntime,
    ensureLiveRuntime,
    runBrowserAction,
  };
}
