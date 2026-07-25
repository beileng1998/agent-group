// FILE: ChatWorkspaceSurface.tsx
// Purpose: Composes the chat, terminal, environment, and plan workspace surfaces.
// Layer: Chat workspace layout

import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

import PlanSidebar from "../PlanSidebar";
import TerminalWorkspaceTabs from "../TerminalWorkspaceTabs";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";
import { cn } from "~/lib/utils";

import { useManagedAgentTerminal } from "../agent-terminal/ManagedAgentTerminalContext";
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

  return (
    <>
      {tabs.visible && !managedTerminalActive ? <TerminalWorkspaceTabs {...tabs.props} /> : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            aria-hidden={chat.terminalWorkspaceActive && !managedTerminalActive}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              chat.terminalWorkspaceActive && !managedTerminalActive
                ? "pointer-events-none invisible"
                : "",
            )}
          >
            {managedTerminalActive ? (
              <Suspense fallback={<PanelStateMessage>Loading Terminal...</PanelStateMessage>}>
                <ManagedAgentTerminalSurface />
              </Suspense>
            ) : (
              chat.content
            )}
          </div>

          <TerminalWorkspaceLayer
            open={terminal.workspace.open && !managedTerminalActive}
            active={terminal.workspace.active && !managedTerminalActive}
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

      {terminal.open && !terminal.workspace.open && !managedTerminalActive ? (
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
