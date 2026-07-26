// FILE: ChatWorkspaceSurface.tsx
// Purpose: Composes the chat, terminal, environment, and plan workspace surfaces.
// Layer: Chat workspace layout

import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import PlanSidebar from "../PlanSidebar";
import TerminalWorkspaceTabs from "../TerminalWorkspaceTabs";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";
import { Loader2Icon, TerminalIcon } from "../../lib/icons";
import { useManagedAgentTerminal } from "../agent-terminal/ManagedAgentTerminalContext";
import { canSwitchManagedTerminalToChat } from "../agent-terminal/managedTerminalPresentation";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { EnvironmentPanel } from "./environment/EnvironmentPanel";
import { PanelStateMessage } from "./PanelStateMessage";
import { TerminalWorkspaceLayer } from "./TerminalWorkspaceLayer";

const ManagedAgentTerminalSurface = lazy(() =>
  import("../agent-terminal/ManagedAgentTerminalSurface").then((module) => ({
    default: module.ManagedAgentTerminalSurface,
  })),
);

type TerminalDrawerProps = ComponentProps<typeof ThreadTerminalDrawer>;
type TerminalDrawerBaseProps = Omit<
  TerminalDrawerProps,
  "isVisible" | "onTogglePresentationMode" | "presentationMode"
>;

export interface ChatWorkspaceSurfaceModel {
  readonly tabs: {
    readonly visible: boolean;
    readonly props: ComponentProps<typeof TerminalWorkspaceTabs>;
  };
  readonly chat: {
    readonly content: ReactNode;
    readonly terminalWorkspaceActive: boolean;
  };
  readonly terminal: {
    readonly open: boolean;
    readonly drawerProps: TerminalDrawerBaseProps;
    readonly workspace: {
      readonly open: boolean;
      readonly active: boolean;
      readonly onTogglePresentationMode: TerminalDrawerProps["onTogglePresentationMode"];
    };
    readonly drawer: {
      readonly onTogglePresentationMode: TerminalDrawerProps["onTogglePresentationMode"];
    };
  };
  readonly environment: {
    readonly enabled: boolean;
    readonly props: ComponentProps<typeof EnvironmentPanel>;
  };
  readonly plan: {
    readonly open: boolean;
    readonly props: ComponentProps<typeof PlanSidebar>;
  };
}

export function ChatWorkspaceSurface({ model }: { model: ChatWorkspaceSurfaceModel }) {
  const { tabs, chat, terminal, environment, plan } = model;
  const terminalThreadId = terminal.drawerProps.threadId;
  const managedAgentTerminal = useManagedAgentTerminal();
  const managedTerminalActive = managedAgentTerminal?.active === true;
  const managedTerminalVisible = managedAgentTerminal?.surface === "terminal";
  const managedTerminalOwnsWorkspace = managedTerminalActive || managedTerminalVisible;
  const showManagedTerminalBanner = managedTerminalActive && !managedTerminalVisible;
  const terminalState = managedAgentTerminal?.state ?? null;
  const canReturnControl =
    canSwitchManagedTerminalToChat(terminalState) &&
    managedAgentTerminal?.pendingAction !== "switch-to-chat";
  const returnControlReason =
    terminalState?.status === "running"
      ? "Finish or interrupt the current Terminal turn before returning control."
      : terminalState?.status === "stopping"
        ? "Terminal is stopping before Chat regains control."
        : "Chat history is read-only while Terminal controls this session.";

  return (
    <>
      {tabs.visible && !managedTerminalOwnsWorkspace ? (
        <TerminalWorkspaceTabs {...tabs.props} />
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            aria-hidden={
              managedTerminalVisible ||
              (chat.terminalWorkspaceActive && !managedTerminalOwnsWorkspace)
            }
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              (chat.terminalWorkspaceActive && !managedTerminalOwnsWorkspace) ||
                managedTerminalVisible
                ? "pointer-events-none invisible"
                : "",
            )}
          >
            {showManagedTerminalBanner ? (
              <div
                role="status"
                className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-[var(--color-background-button-secondary)] px-3 py-2 text-xs text-[var(--color-text-foreground-secondary)]"
              >
                <TerminalIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{returnControlReason}</span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canReturnControl || managedAgentTerminal?.busy}
                  title={returnControlReason}
                  onClick={() => {
                    void managedAgentTerminal?.switchToChat().catch((error: unknown) => {
                      toastManager.add({
                        type: "error",
                        title: "Unable to return control to Chat",
                        description:
                          error instanceof Error
                            ? error.message
                            : "The execution adapter did not switch.",
                      });
                    });
                  }}
                >
                  {managedAgentTerminal?.pendingAction === "switch-to-chat" ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  Return control to Chat
                </Button>
              </div>
            ) : null}
            {chat.content}
          </div>

          {managedAgentTerminal?.available ? (
            <div
              aria-hidden={!managedTerminalVisible}
              className={cn(
                "absolute inset-0 flex min-h-0 min-w-0 flex-col",
                managedTerminalVisible ? "z-[2]" : "pointer-events-none invisible z-0",
              )}
            >
              <Suspense fallback={<PanelStateMessage>Loading Terminal...</PanelStateMessage>}>
                <ManagedAgentTerminalSurface />
              </Suspense>
            </div>
          ) : null}

          <TerminalWorkspaceLayer
            open={terminal.workspace.open && !managedTerminalOwnsWorkspace}
            active={terminal.workspace.active && !managedTerminalOwnsWorkspace}
          >
            <ThreadTerminalDrawer
              key={`${terminalThreadId}-workspace`}
              {...terminal.drawerProps}
              presentationMode="workspace"
              isVisible={terminal.workspace.active}
              onTogglePresentationMode={terminal.workspace.onTogglePresentationMode}
            />
          </TerminalWorkspaceLayer>

          {/* Keep mounted while enabled so open/close transitions stay in sync with inset. */}
          {environment.enabled ? <EnvironmentPanel {...environment.props} /> : null}
        </div>

        {plan.open ? <PlanSidebar {...plan.props} /> : null}
      </div>

      {terminal.open && !terminal.workspace.open && !managedTerminalOwnsWorkspace ? (
        <ThreadTerminalDrawer
          key={terminalThreadId}
          {...terminal.drawerProps}
          presentationMode="drawer"
          onTogglePresentationMode={terminal.drawer.onTogglePresentationMode}
        />
      ) : null}
    </>
  );
}
