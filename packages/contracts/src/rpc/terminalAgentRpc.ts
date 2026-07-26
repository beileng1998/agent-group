import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  TerminalAgentEvent,
  TerminalAgentGetInput,
  TerminalAgentResizeInput,
  TerminalAgentRestartInput,
  TerminalAgentRuntimeState,
  TerminalAgentStartInput,
  TerminalAgentSubscribeInput,
  TerminalAgentSwitchToChatInput,
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

export const WsTerminalAgentSwitchToChatRpc = Rpc.make(WS_METHODS.terminalAgentSwitchToChat, {
  payload: TerminalAgentSwitchToChatInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

export const WsTerminalAgentRestartRpc = Rpc.make(WS_METHODS.terminalAgentRestart, {
  payload: TerminalAgentRestartInput,
  success: TerminalAgentRuntimeState,
  error: WsRpcError,
});

/** Terminal-mode subscriptions are snapshot-first; state-only streams are not. */
export const WsTerminalAgentSubscribeRpc = Rpc.make(WS_METHODS.terminalAgentSubscribe, {
  payload: TerminalAgentSubscribeInput,
  success: TerminalAgentEvent,
  error: WsRpcError,
  stream: true,
});
