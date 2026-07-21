import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  AgentGroupConfig,
  AgentGroupGetConfigInput,
  AgentGroupGetOverviewInput,
  AgentGroupGetSessionInput,
  AgentGroupOverview,
  AgentGroupSessionDocument,
  AgentGroupUpdateConfigInput,
  AgentGroupUpdateSessionInput,
  AgentGroupWriteContextInput,
} from "../agentGroup";
import { HighlightsListInput, HighlightsListOutput } from "../highlights";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationRpcSchemas,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../orchestration";
import { WS_METHODS } from "../ws";
import { WsRpcError } from "./errors";

export const WsDialogsPickFolderRpc = Rpc.make(WS_METHODS.dialogsPickFolder, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(Schema.String),
  error: WsRpcError,
});

export const WsAgentGroupGetSessionRpc = Rpc.make(WS_METHODS.agentGroupGetSession, {
  payload: AgentGroupGetSessionInput,
  success: AgentGroupSessionDocument,
  error: WsRpcError,
});

export const WsAgentGroupGetConfigRpc = Rpc.make(WS_METHODS.agentGroupGetConfig, {
  payload: AgentGroupGetConfigInput,
  success: AgentGroupConfig,
  error: WsRpcError,
});

export const WsAgentGroupGetOverviewRpc = Rpc.make(WS_METHODS.agentGroupGetOverview, {
  payload: AgentGroupGetOverviewInput,
  success: AgentGroupOverview,
  error: WsRpcError,
});

export const WsAgentGroupWriteContextRpc = Rpc.make(WS_METHODS.agentGroupWriteContext, {
  payload: AgentGroupWriteContextInput,
  success: AgentGroupSessionDocument,
  error: WsRpcError,
});

export const WsAgentGroupUpdateConfigRpc = Rpc.make(WS_METHODS.agentGroupUpdateConfig, {
  payload: AgentGroupUpdateConfigInput,
  success: AgentGroupConfig,
  error: WsRpcError,
});

export const WsAgentGroupUpdateSessionRpc = Rpc.make(WS_METHODS.agentGroupUpdateSession, {
  payload: AgentGroupUpdateSessionInput,
  success: AgentGroupSessionDocument,
  error: WsRpcError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationImportThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.importThread, {
  payload: OrchestrationImportThreadInput,
  success: OrchestrationImportThreadResult,
  error: WsRpcError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationRpcSchemas.getSnapshot.input,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: WsRpcError,
});

export const WsOrchestrationGetShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getShellSnapshot.input,
    success: OrchestrationRpcSchemas.getShellSnapshot.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationListHighlightsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.listHighlights, {
  payload: HighlightsListInput,
  success: HighlightsListOutput,
  error: WsRpcError,
});

export const WsOrchestrationRepairStateRpc = Rpc.make(ORCHESTRATION_WS_METHODS.repairState, {
  payload: OrchestrationRpcSchemas.repairState.input,
  success: OrchestrationRpcSchemas.repairState.output,
  error: WsRpcError,
});

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationRpcSchemas.getTurnDiff.input,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: WsRpcError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationRpcSchemas.getFullThreadDiff.input,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationRpcSchemas.replayEvents.input,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: WsRpcError,
});

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationShellStreamItem,
  error: WsRpcError,
  stream: true,
});

export const WsOrchestrationUnsubscribeShellRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeShell,
  {
    payload: OrchestrationRpcSchemas.unsubscribeShell.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationThreadStreamItem,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationUnsubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeThread,
  {
    payload: OrchestrationRpcSchemas.unsubscribeThread.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);
