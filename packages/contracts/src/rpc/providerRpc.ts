import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { ProviderCompactThreadInput } from "../provider";
import {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  ProviderSkillsCatalogInput,
  ProviderSkillsCatalogResult,
} from "../providerDiscovery";
import { WS_METHODS } from "../ws";
import { WsRpcError } from "./errors";

export const WsProviderGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerGetComposerCapabilities,
  {
    payload: ProviderGetComposerCapabilitiesInput,
    success: ProviderComposerCapabilities,
    error: WsRpcError,
  },
);

export const WsProviderCompactThreadRpc = Rpc.make(WS_METHODS.providerCompactThread, {
  payload: ProviderCompactThreadInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsProviderListCommandsRpc = Rpc.make(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsRpc = Rpc.make(WS_METHODS.providerListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsCatalogRpc = Rpc.make(WS_METHODS.providerListSkillsCatalog, {
  payload: ProviderSkillsCatalogInput,
  success: ProviderSkillsCatalogResult,
  error: WsRpcError,
});

export const WsProviderListPluginsRpc = Rpc.make(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
  error: WsRpcError,
});

export const WsProviderReadPluginRpc = Rpc.make(WS_METHODS.providerReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
  error: WsRpcError,
});

export const WsProviderListModelsRpc = Rpc.make(WS_METHODS.providerListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
  error: WsRpcError,
});

export const WsProviderListAgentsRpc = Rpc.make(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
  error: WsRpcError,
});
