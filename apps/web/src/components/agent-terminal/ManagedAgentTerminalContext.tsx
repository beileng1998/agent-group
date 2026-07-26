import type { TerminalAgentRuntimeState, ThreadId } from "@agent-group/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type ManagedAgentTerminalSurface = "chat" | "terminal";
export type ManagedAgentTerminalAction = "start" | "switch-to-chat" | "restart" | "stop";

export interface ManagedAgentTerminalController {
  readonly threadId: ThreadId;
  readonly state: TerminalAgentRuntimeState | null;
  readonly active: boolean;
  readonly available: boolean;
  readonly busy: boolean;
  readonly pendingAction: ManagedAgentTerminalAction | null;
  readonly surface: ManagedAgentTerminalSurface;
  readonly featureEnabled: boolean;
  readonly startBlockedReason: string | null;
  readonly showSurface: (surface: ManagedAgentTerminalSurface) => void;
  readonly start: () => Promise<void>;
  readonly switchToChat: () => Promise<void>;
  readonly restart: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly setViewportSize: (cols: number, rows: number) => void;
}

export type ManagedAgentTerminalCoreController = Omit<
  ManagedAgentTerminalController,
  "surface" | "showSurface"
>;

const ManagedAgentTerminalContext = createContext<ManagedAgentTerminalController | null>(null);

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

/**
 * Owns presentation-only surface selection below ChatView's runtime graphs.
 * Switching tabs therefore cannot rebuild a long structured transcript.
 */
export function ManagedAgentTerminalControllerProvider(props: {
  readonly controller: ManagedAgentTerminalCoreController;
  readonly children: ReactNode;
}) {
  const { controller } = props;
  const [selection, setSelection] = useState<{
    readonly threadId: ThreadId;
    readonly surface: ManagedAgentTerminalSurface;
  } | null>(null);
  const presentationIntentRef = useRef(0);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const surface =
    selection?.threadId === controller.threadId
      ? selection.surface
      : controller.active
        ? "terminal"
        : "chat";
  const showSurface = useCallback(
    (nextSurface: ManagedAgentTerminalSurface) => {
      presentationIntentRef.current += 1;
      setSelection({
        threadId: controller.threadId,
        surface: nextSurface,
      });
    },
    [controller.threadId],
  );
  const start = useCallback(async () => {
    const threadId = controller.threadId;
    const intent = ++presentationIntentRef.current;
    setSelection({ threadId, surface: "chat" });
    await controller.start();
    if (presentationIntentRef.current !== intent || controllerRef.current.threadId !== threadId) {
      return;
    }
    setSelection({ threadId, surface: "terminal" });
  }, [controller.start, controller.threadId]);
  const value = useMemo(
    () => ({ ...controller, surface, showSurface, start }),
    [controller, showSurface, start, surface],
  );

  return (
    <ManagedAgentTerminalProvider value={value}>{props.children}</ManagedAgentTerminalProvider>
  );
}

export function useManagedAgentTerminal(): ManagedAgentTerminalController | null {
  return useContext(ManagedAgentTerminalContext);
}
