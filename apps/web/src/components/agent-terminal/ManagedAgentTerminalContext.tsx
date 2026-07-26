import type { TerminalAgentRuntimeState, ThreadId } from "@agent-group/contracts";
import { createContext, type ReactNode, useContext } from "react";

export type ManagedAgentTerminalSurface = "chat" | "terminal";
export type ManagedAgentTerminalAction =
  | "start"
  | "switch-to-chat"
  | "restart"
  | "stop";

export interface ManagedAgentTerminalController {
  readonly threadId: ThreadId;
  readonly state: TerminalAgentRuntimeState | null;
  readonly active: boolean;
  readonly available: boolean;
  readonly busy: boolean;
  readonly pendingAction: ManagedAgentTerminalAction | null;
  readonly surface: ManagedAgentTerminalSurface;
  readonly featureEnabled: boolean;
  readonly showSurface: (surface: ManagedAgentTerminalSurface) => void;
  readonly start: () => Promise<void>;
  readonly switchToChat: () => Promise<void>;
  readonly restart: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly setViewportSize: (cols: number, rows: number) => void;
}

const ManagedAgentTerminalContext =
  createContext<ManagedAgentTerminalController | null>(null);

export function ManagedAgentTerminalProvider(props: {
  readonly value: ManagedAgentTerminalController;
  readonly children: ReactNode;
}) {
  return (
    <ManagedAgentTerminalContext.Provider value={props.value}>
      {props.children}
    </ManagedAgentTerminalContext.Provider>
  );
}

export function useManagedAgentTerminal(): ManagedAgentTerminalController | null {
  return useContext(ManagedAgentTerminalContext);
}
