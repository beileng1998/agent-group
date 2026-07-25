import type { TerminalAgentRuntimeState, ThreadId } from "@agent-group/contracts";
import { createContext, type ReactNode, useContext } from "react";

export interface ManagedAgentTerminalController {
  readonly threadId: ThreadId;
  readonly state: TerminalAgentRuntimeState | null;
  readonly active: boolean;
  readonly available: boolean;
  readonly busy: boolean;
  readonly featureEnabled: boolean;
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
