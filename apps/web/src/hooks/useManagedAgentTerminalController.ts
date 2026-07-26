import type {
  ProviderKind,
  TerminalAgentEvent,
  TerminalAgentRuntimeState,
  ThreadId,
} from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ManagedAgentTerminalCoreController,
  ManagedAgentTerminalAction,
} from "../components/agent-terminal/ManagedAgentTerminalContext";
import {
  acceptManagedTerminalRpcState,
  acceptManagedTerminalState,
  isManagedTerminalAuthority,
  isManagedTerminalProvider,
  managedTerminalEventThreadId,
} from "../components/agent-terminal/managedTerminalPresentation";
import { newCommandId } from "../lib/utils";
import { serverSettingsQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";

const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

export function useManagedAgentTerminalController(input: {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind | null | undefined;
  readonly serverBacked: boolean;
  readonly startBlockedReason?: string | null;
}): ManagedAgentTerminalCoreController {
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const featureEnabled = settingsQuery.data?.enableManagedAgentTerminal === true;
  const [state, setState] = useState<TerminalAgentRuntimeState | null>(null);
  const [pendingAction, setPendingAction] =
    useState<ManagedAgentTerminalAction | null>(null);
  const busyRef = useRef(false);
  const mutationTokenRef = useRef<symbol | null>(null);
  const requestVersionRef = useRef(0);
  const streamEventVersionRef = useRef(0);
  const viewportRef = useRef({ cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS });

  const runMutation = useCallback(
    async (
      action: ManagedAgentTerminalAction,
      mutation: (
        api: NonNullable<ReturnType<typeof readNativeApi>>,
      ) => Promise<TerminalAgentRuntimeState | null>,
    ) => {
      if (busyRef.current) {
        throw new Error("Another Agent Terminal action is already in progress.");
      }
      const api = readNativeApi();
      if (!api?.terminalAgent) {
        throw new Error("Managed Agent Terminal is unavailable.");
      }
      const token = Symbol("terminal-agent-mutation");
      mutationTokenRef.current = token;
      busyRef.current = true;
      setPendingAction(action);
      const streamVersion = streamEventVersionRef.current;
      try {
        const next = await mutation(api);
        if (next && mutationTokenRef.current === token) {
          const streamAdvanced =
            streamEventVersionRef.current !== streamVersion;
          setState((current) =>
            streamAdvanced
              ? acceptManagedTerminalRpcState(current, next)
              : acceptManagedTerminalState(current, next),
          );
        }
      } finally {
        if (mutationTokenRef.current === token) {
          mutationTokenRef.current = null;
          busyRef.current = false;
          setPendingAction(null);
        }
      }
    },
    [],
  );

  const start = useCallback(
    () => {
      if (input.startBlockedReason) {
        return Promise.reject(new Error(input.startBlockedReason));
      }
      return runMutation("start", (api) =>
        api.terminalAgent.start({
          threadId: input.threadId,
          cols: viewportRef.current.cols,
          rows: viewportRef.current.rows,
        }),
      );
    },
    [input.startBlockedReason, input.threadId, runMutation],
  );
  const switchToChat = useCallback(
    () =>
      runMutation("switch-to-chat", (api) =>
        api.terminalAgent.switchToChat({ threadId: input.threadId }),
      ),
    [input.threadId, runMutation],
  );
  const restart = useCallback(
    () =>
      runMutation("restart", (api) =>
        api.terminalAgent.restart({
          threadId: input.threadId,
          cols: viewportRef.current.cols,
          rows: viewportRef.current.rows,
        }),
      ),
    [input.threadId, runMutation],
  );
  const stop = useCallback(
    () =>
      runMutation("stop", async (api) => {
        await api.orchestration.dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: input.threadId,
          createdAt: new Date().toISOString(),
        });
        return null;
      }),
    [input.threadId, runMutation],
  );
  const acceptEvent = useCallback(
    (event: TerminalAgentEvent) => {
      if (managedTerminalEventThreadId(event) !== input.threadId) return;
      streamEventVersionRef.current += 1;
      if (event.type === "state") {
        setState((current) => acceptManagedTerminalState(current, event.state));
        return;
      }
      if (event.type === "exited") {
        setState((current) => {
          if (
            !current ||
            current.authority !== "terminal" ||
            current.revision !== event.revision ||
            current.generation !== event.generation
          ) {
            return current;
          }
          return {
            ...current,
            status: "exited",
            exit: event.exit,
          };
        });
      } else if (event.type === "error") {
        setState((current) => {
          if (!current || current.revision !== event.revision) return current;
          if (event.generation && current.generation !== event.generation) return current;
          return { ...current, status: "error", error: event.message };
        });
      }
    },
    [input.threadId],
  );
  useEffect(() => {
    const api = readNativeApi();
    const requestVersion = ++requestVersionRef.current;
    const streamVersion = ++streamEventVersionRef.current;
    mutationTokenRef.current = null;
    busyRef.current = false;
    setPendingAction(null);
    setState(null);
    if (!api?.terminalAgent || !input.serverBacked) return;
    let unsubscribe = () => {};
    try {
      unsubscribe = api.terminalAgent.subscribe(
        { threadId: input.threadId, mode: "state" },
        acceptEvent,
      );
    } catch {
      // The initial get remains the compatibility path for older servers.
    }
    void api.terminalAgent.get({ threadId: input.threadId }).then(
      (next) => {
        if (requestVersionRef.current !== requestVersion) return;
        const streamAdvanced =
          streamEventVersionRef.current !== streamVersion;
        setState((current) =>
          streamAdvanced
            ? acceptManagedTerminalRpcState(current, next)
            : acceptManagedTerminalState(current, next),
        );
      },
      () => {
        // The feature defaults off and older servers may not expose the RPC.
      },
    );
    return () => {
      requestVersionRef.current += 1;
      unsubscribe();
    };
  }, [acceptEvent, input.serverBacked, input.threadId]);
  const setViewportSize = useCallback((cols: number, rows: number) => {
    viewportRef.current = { cols, rows };
  }, []);
  const currentState = state?.threadId === input.threadId ? state : null;
  const active = isManagedTerminalAuthority(currentState);
  const available =
    input.serverBacked &&
    (active || (featureEnabled && isManagedTerminalProvider(input.provider)));
  const busy = pendingAction !== null;

  return useMemo(
    () => ({
      threadId: input.threadId,
      state: currentState,
      active,
      available,
      busy,
      pendingAction,
      featureEnabled,
      startBlockedReason: input.startBlockedReason ?? null,
      start,
      switchToChat,
      restart,
      stop,
      setViewportSize,
    }),
    [
      active,
      available,
      busy,
      featureEnabled,
      input.threadId,
      input.startBlockedReason,
      currentState,
      pendingAction,
      restart,
      setViewportSize,
      start,
      stop,
      switchToChat,
    ],
  );
}
