import { type ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import { type DiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { readNativeApi } from "../nativeApi";
import { isSplitRoute } from "../splitViewRoute";
import { type SplitView } from "../splitViewStore";

export interface MissingThreadRouteRecoveryInput {
  threadId: ThreadId;
  routeThreadExists: boolean;
  hasKnownServerThreads: boolean;
  threadsHydrated: boolean;
  splitViewsHydrated: boolean;
  search: DiffRouteSearch;
  splitView: SplitView | null;
}

export interface MissingThreadRouteRecoveryModel {
  shouldHoldRoute: boolean;
  routeReady: boolean;
}

export function useMissingThreadRouteRecovery(
  input: MissingThreadRouteRecoveryInput,
): MissingThreadRouteRecoveryModel {
  const navigate = useNavigate();
  const [recoveryState, setRecoveryState] = useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const recoveryRunRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    recoveryRunRef.current += 1;
    setRecoveryState("idle");
  }, [input.threadId]);

  useEffect(() => {
    if (input.routeThreadExists && recoveryState !== "idle") {
      recoveryRunRef.current += 1;
      setRecoveryState("idle");
    }
  }, [input.routeThreadExists, recoveryState]);

  useEffect(() => {
    if (!input.threadsHydrated || !input.splitViewsHydrated) {
      return;
    }

    if (!input.routeThreadExists) {
      if (
        shouldStartMissingThreadRouteRecovery({
          hasKnownServerThreads: input.hasKnownServerThreads,
          recoveryState,
          routeThreadExists: input.routeThreadExists,
        })
      ) {
        const recoveryRun = (recoveryRunRef.current += 1);
        setRecoveryState("pending");
        void Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]).finally(() => {
          if (mountedRef.current && recoveryRunRef.current === recoveryRun) {
            setRecoveryState("done");
          }
        });
        return;
      }

      if (
        shouldHoldMissingThreadRouteFallback({
          hasKnownServerThreads: input.hasKnownServerThreads,
          recoveryState,
          routeThreadExists: input.routeThreadExists,
        })
      ) {
        return;
      }
    }

    if (isSplitRoute(input.search)) {
      if (!input.splitView) {
        void navigate({
          to: "/$threadId",
          params: { threadId: input.threadId },
          replace: true,
          search: (previous) => ({
            ...stripDiffSearchParams(previous),
            splitViewId: undefined,
          }),
        });
      }
      return;
    }

    if (!input.routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    input.hasKnownServerThreads,
    input.routeThreadExists,
    input.search,
    input.splitView,
    input.splitViewsHydrated,
    input.threadId,
    input.threadsHydrated,
    navigate,
    recoveryState,
  ]);

  const shouldHoldRoute =
    !input.threadsHydrated ||
    !input.splitViewsHydrated ||
    shouldHoldMissingThreadRouteFallback({
      hasKnownServerThreads: input.hasKnownServerThreads,
      recoveryState,
      routeThreadExists: input.routeThreadExists,
    });

  return {
    shouldHoldRoute,
    routeReady: !shouldHoldRoute,
  };
}
