import { Loader2Icon, MessageCircleIcon, TerminalIcon } from "../../../lib/icons";
import { cn } from "../../../lib/utils";
import { useManagedAgentTerminal } from "../../agent-terminal/ManagedAgentTerminalContext";
import {
  canSwitchManagedTerminalToChat,
  managedTerminalProviderLabel,
  managedTerminalStatusLabel,
} from "../../agent-terminal/managedTerminalPresentation";
import { toastManager } from "../../ui/toast";
import {
  CHAT_SURFACE_CHIP_CLASS_NAME,
  CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
} from "../chatHeaderControls";

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

export function AgentTerminalControl() {
  const controller = useManagedAgentTerminal();
  if (!controller?.available) return null;

  const state = controller.state;
  const terminalLabel = state
    ? managedTerminalProviderLabel(state.provider)
    : "Agent";
  const terminalTitle = controller.featureEnabled
    ? `Switch to ${terminalLabel} Terminal`
    : "Managed Agent Terminal is disabled for new sessions";

  return (
    <div
      role="group"
      aria-label="Session interface"
      className="flex h-7 items-center rounded-lg bg-[var(--color-background-button-secondary)] p-0.5"
    >
      <button
        type="button"
        aria-pressed={!controller.active}
        disabled={
          controller.busy ||
          (controller.active && !canSwitchManagedTerminalToChat(state))
        }
        className={cn(
          CHAT_SURFACE_CHIP_CLASS_NAME,
          !controller.active && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
        )}
        onClick={() => {
          if (controller.active) void reportSwitch(controller.switchToChat, "Chat");
        }}
      >
        {controller.busy && controller.active ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <MessageCircleIcon className="size-3.5" />
        )}
        Chat
      </button>
      <button
        type="button"
        aria-pressed={controller.active}
        disabled={controller.busy || (!controller.active && !controller.featureEnabled)}
        title={
          controller.active && state
            ? `${terminalLabel} · ${managedTerminalStatusLabel(state)}`
            : terminalTitle
        }
        className={cn(
          CHAT_SURFACE_CHIP_CLASS_NAME,
          controller.active && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
        )}
        onClick={() => {
          if (!controller.active) void reportSwitch(controller.start, "Terminal");
        }}
      >
        {controller.busy && !controller.active ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <TerminalIcon className="size-3.5" />
        )}
        Terminal
      </button>
    </div>
  );
}
