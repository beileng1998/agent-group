import "@xterm/xterm/css/xterm.css";

import { TERMINAL_AGENT_SCROLLBACK_ROWS } from "@agent-group/shared/terminalAgent";
import { useEffect, useRef, useState } from "react";

import { Loader2Icon, RefreshCwIcon, StopFilledIcon, TriangleAlertIcon } from "../../lib/icons";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { toastManager } from "../ui/toast";
import { useManagedAgentTerminal } from "./ManagedAgentTerminalContext";
import type { ManagedTerminalConnectionStatus } from "./managedAgentTerminalRuntime";
import { managedAgentTerminalRuntimeRegistry } from "./managedAgentTerminalRuntimeRegistry";
import {
  canRestartManagedTerminal,
  managedTerminalProviderLabel,
  managedTerminalStatusLabel,
} from "./managedTerminalPresentation";

function connectionLabel(status: ManagedTerminalConnectionStatus): string {
  switch (status) {
    case "ready":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Connection failed";
    default:
      return "Connecting";
  }
}

export function ManagedAgentTerminalSurface() {
  const controller = useManagedAgentTerminal();
  const mountRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<() => void>(() => {});
  const [connection, setConnection] = useState<{
    readonly threadId: string;
    readonly status: ManagedTerminalConnectionStatus;
  } | null>(null);
  const visible = controller?.surface === "terminal";
  const threadId = controller?.threadId;
  const setViewportSize = controller?.setViewportSize;

  useEffect(() => {
    const mount = mountRef.current;
    if (!visible || !threadId || !setViewportSize || !mount) return;
    const attached = managedAgentTerminalRuntimeRegistry.attach(threadId, mount, {
      setViewportSize,
      onConnectionStatusChange: (status) => {
        setConnection({ threadId, status });
      },
    });
    retryRef.current = attached.retry;
    setConnection({ threadId, status: attached.status });
    return () => {
      managedAgentTerminalRuntimeRegistry.detach(threadId, mount);
      retryRef.current = () => {};
    };
  }, [setViewportSize, threadId, visible]);

  if (!controller || !visible) return null;
  const state = controller.state;
  const active = controller.active && state?.authority === "terminal";
  const status = connection?.threadId === controller.threadId ? connection.status : "connecting";
  const restarting = controller.pendingAction === "restart";
  const stopping = controller.pendingAction === "stop";
  const error = state?.error ?? null;
  const providerLabel = state ? managedTerminalProviderLabel(state.provider) : "Agent";
  const runtimeStatus = active
    ? managedTerminalStatusLabel(state)
    : controller.pendingAction === "start"
      ? "Starting"
      : "Not started";
  const showConnectionNotice = !active || status !== "ready";

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]"
      aria-label={`${providerLabel} terminal`}
    >
      <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-border/70 px-3 py-1 text-xs text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground">{providerLabel}</span>
        <span className="shrink-0" aria-live="polite">
          {runtimeStatus}
        </span>
        {state?.model ? <span className="min-w-0 truncate">{state.model}</span> : null}
        <span
          className="hidden shrink-0 lg:inline"
          title="Older terminal output is omitted to keep restores fast."
        >
          Latest {TERMINAL_AGENT_SCROLLBACK_ROWS.toLocaleString()} lines
        </span>
        <span className="ml-auto hidden shrink-0 sm:inline">{connectionLabel(status)}</span>
        {active && canRestartManagedTerminal(state) ? (
          <Button
            size="xs"
            variant="outline"
            disabled={controller.busy}
            title="Restart Terminal"
            onClick={() => {
              void controller.restart().catch((restartError: unknown) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to restart Terminal",
                  description:
                    restartError instanceof Error
                      ? restartError.message
                      : "The terminal runtime did not restart.",
                });
              });
            }}
          >
            {restarting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            <span className="hidden sm:inline">Restart</span>
          </Button>
        ) : null}
        {active ? (
          <Button
            size="xs"
            variant="outline"
            disabled={
              controller.busy ||
              state?.status === "stopping" ||
              state?.status === "stopped" ||
              state?.status === "exited"
            }
            title="Stop Terminal"
            onClick={() => {
              void controller.stop().catch((stopError: unknown) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to stop Terminal",
                  description:
                    stopError instanceof Error
                      ? stopError.message
                      : "The terminal runtime did not stop.",
                });
              });
            }}
          >
            {stopping ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <StopFilledIcon className="size-3.5" />
            )}
            <span className="hidden sm:inline">Stop</span>
          </Button>
        ) : null}
      </div>
      <DisclosureRegion open={Boolean(error)}>
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      </DisclosureRegion>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={mountRef} className="absolute inset-0 p-2" />
        {showConnectionNotice ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background-surface)]/92 p-6">
            <div
              role="status"
              className="flex max-w-sm flex-col items-center gap-3 text-center text-sm text-muted-foreground"
            >
              {status === "error" ? (
                <TriangleAlertIcon className="size-5 text-destructive" />
              ) : (
                <Loader2Icon className="size-5 animate-spin" />
              )}
              <span>
                {!active
                  ? controller.pendingAction === "start"
                    ? "Starting Agent Terminal..."
                    : "Agent Terminal is not running."
                  : status === "reconnecting"
                    ? "Reconnecting and restoring recent Terminal history..."
                    : status === "error"
                      ? "The Terminal stream is unavailable."
                      : `Restoring up to ${TERMINAL_AGENT_SCROLLBACK_ROWS.toLocaleString()} recent lines...`}
              </span>
              {active && status === "error" ? (
                <Button size="xs" variant="outline" onClick={() => retryRef.current()}>
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
