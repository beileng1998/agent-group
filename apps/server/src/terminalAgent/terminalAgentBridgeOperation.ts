import type {
  TerminalAgentBridgeRequest,
  TerminalAgentHookResponse,
} from "./terminalAgentProtocol";

export interface TerminalAgentBridgeOperation {
  readonly result: Promise<TerminalAgentHookResponse>;
  readonly cancel?: () => Promise<void>;
}

export type TerminalAgentBridgePromise = Promise<TerminalAgentHookResponse> & {
  cancel?: () => Promise<void>;
};

export type TerminalAgentBridgeHandler = (
  request: TerminalAgentBridgeRequest,
  signal: AbortSignal,
) => TerminalAgentBridgePromise | TerminalAgentBridgeOperation;

export function resolveTerminalAgentBridgeOperation(
  value: ReturnType<TerminalAgentBridgeHandler>,
): TerminalAgentBridgeOperation {
  return "result" in value
    ? value
    : { result: value, ...(value.cancel ? { cancel: value.cancel } : {}) };
}
