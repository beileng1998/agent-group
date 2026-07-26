import {
  Loader2Icon,
  MessageCircleIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "../../../lib/icons";
import { cn } from "../../../lib/utils";
import { useManagedAgentTerminal } from "../../agent-terminal/ManagedAgentTerminalContext";
import {
  managedTerminalProviderLabel,
  managedTerminalStatusLabel,
} from "../../agent-terminal/managedTerminalPresentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { toastManager } from "../../ui/toast";

async function reportSwitch(
  action: () => Promise<void>,
  destination: "Chat" | "Terminal",
): Promise<void> {
  try {
    await action();
  } catch (error) {
    toastManager.add({
      type: "error",
      title: `Unable to switch to ${destination}`,
      description: error instanceof Error ? error.message : "The session interface did not switch.",
    });
  }
}

const SEGMENT_CLASS_NAME =
  "inline-flex h-6 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[length:var(--app-font-size-ui-sm,11px)] font-normal transition-[background-color,color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50";
const ACTIVE_SEGMENT_CLASS_NAME =
  "bg-[var(--color-background-surface)] text-[var(--color-text-foreground)] shadow-sm";
const IDLE_SEGMENT_CLASS_NAME =
  "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]";

export function AgentTerminalControl({ compact = false }: { compact?: boolean }) {
  const controller = useManagedAgentTerminal();
  if (!controller?.available) return null;

  const state = controller.state;
  const terminalSelected = controller.surface === "terminal";
  const terminalLabel = state ? managedTerminalProviderLabel(state.provider) : "Agent";
  const startBlockedReason = !controller.active ? controller.startBlockedReason : null;
  const terminalTitle =
    startBlockedReason ??
    (controller.featureEnabled
      ? `Switch to ${terminalLabel} Terminal`
      : "Managed Agent Terminal is disabled for new sessions");

  return (
    <div
      role="tablist"
      aria-label="Session interface"
      className="inline-flex h-7 shrink-0 items-center rounded-lg bg-[var(--color-background-button-secondary)] p-0.5 ring-1 ring-inset ring-border/40"
    >
      <button
        type="button"
        role="tab"
        aria-selected={!terminalSelected}
        disabled={controller.pendingAction === "switch-to-chat"}
        title="Show Chat history"
        className={cn(
          SEGMENT_CLASS_NAME,
          terminalSelected ? IDLE_SEGMENT_CLASS_NAME : ACTIVE_SEGMENT_CLASS_NAME,
        )}
        onClick={() => {
          controller.showSurface("chat");
        }}
      >
        <MessageCircleIcon className="size-3.5 shrink-0" />
        <span className={cn(compact && "sr-only")}>Chat</span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              role="tab"
              aria-disabled={startBlockedReason !== null}
              aria-selected={terminalSelected}
              disabled={controller.pendingAction === "start"}
              title={
                controller.active && state
                  ? `Show ${terminalLabel} Terminal · ${managedTerminalStatusLabel(state)}`
                  : terminalTitle
              }
              className={cn(
                SEGMENT_CLASS_NAME,
                terminalSelected ? ACTIVE_SEGMENT_CLASS_NAME : IDLE_SEGMENT_CLASS_NAME,
                startBlockedReason && "cursor-not-allowed opacity-55",
              )}
              onClick={() => {
                if (startBlockedReason) {
                  toastManager.add({
                    type: "info",
                    title: "Terminal is waiting for Chat",
                    description: startBlockedReason,
                  });
                  return;
                }
                if (controller.active) {
                  controller.showSurface("terminal");
                } else {
                  void reportSwitch(controller.start, "Terminal");
                }
              }}
            >
              {controller.pendingAction === "start" ? (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
              ) : startBlockedReason ? (
                <TriangleAlertIcon className="size-3.5 shrink-0" />
              ) : (
                <TerminalIcon className="size-3.5 shrink-0" />
              )}
              <span className={cn(compact && "sr-only")}>Terminal</span>
            </button>
          }
        />
        <TooltipPopup side="bottom" className="max-w-72 whitespace-normal">
          {terminalTitle}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
