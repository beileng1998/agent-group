import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  TerminalAgentEvent,
  TerminalAgentGetInput,
  TerminalAgentResizeInput,
  TerminalAgentRestartInput,
  TerminalAgentRuntimeState,
  TerminalAgentStartInput,
  TerminalAgentStopInput,
  TerminalAgentSubscribeInput,
  TerminalAgentSwitchToChatInput,
  TerminalAgentSwitchToTerminalInput,
  TerminalAgentWriteInput,
} from "../terminalAgent";
import { WS_METHODS } from "../ws";
import { WsRpcError } from "./errors";

export const WsTerminalAgentStartRpc = Rpc.make(WS_METHODS.terminalAgentStart, {
  payload: TerminalAgentStartInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

export const WsTerminalAgentGetRpc = Rpc.make(WS_METHODS.terminalAgentGet, {
  payload: TerminalAgentGetInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

export const WsTerminalAgentWriteRpc = Rpc.make(WS_METHODS.terminalAgentWrite, {
  payload: TerminalAgentWriteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalAgentResizeRpc = Rpc.make(WS_METHODS.terminalAgentResize, {
  payload: TerminalAgentResizeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalAgentSwitchToTerminalRpc = Rpc.make(
  WS_METHODS.terminalAgentSwitchToTerminal,
  {
    payload: TerminalAgentSwitchToTerminalInput,
    success: TerminalAgentRuntimeState,
    error: WsRpcError,
  },
);

export const WsTerminalAgentSwitchToChatRpc = Rpc.make(WS_METHODS.terminalAgentSwitchToChat, {
  payload: TerminalAgentSwitchToChatInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

export const WsTerminalAgentStopRpc = Rpc.make(WS_METHODS.terminalAgentStop, {
  payload: TerminalAgentStopInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

export const WsTerminalAgentRestartRpc = Rpc.make(WS_METHODS.terminalAgentRestart, {
  payload: TerminalAgentRestartInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

/**
 * For an active runtime the first stream item is always `attached`; the server
 * must not emit live output before that serialized xterm snapshot.
 */
export const WsTerminalAgentSubscribeRpc = Rpc.make(WS_METHODS.terminalAgentSubscribe, {
  payload: TerminalAgentSubscribeInput,
  success: TerminalAgentEvent,
  error: WsRpcError,
  stream: true,
});
