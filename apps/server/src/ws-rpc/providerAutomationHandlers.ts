import { WS_METHODS, WsRpcError } from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import { AutomationService } from "../automation/Services/AutomationService";
import { ServerConfig } from "../config";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ProviderService } from "../provider/Services/ProviderService";
import { discoverSkillsCatalog, agentGroupSkillsDir } from "../provider/skillsCatalog";
import { toWsRpcError } from "../wsRpcError";
import type { WsRpcHandlers } from "./types";

export function makeProviderAutomationHandlers(dependencies: {
  readonly automationService: typeof AutomationService.Service;
  readonly config: typeof ServerConfig.Service;
  readonly providerDiscoveryService: typeof ProviderDiscoveryService.Service;
  readonly providerService: typeof ProviderService.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  return {
    [WS_METHODS.providerGetComposerCapabilities]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.getComposerCapabilities(input),
        "Failed to get composer capabilities",
      ),
    [WS_METHODS.providerCompactThread]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerService.compactThread(input),
        "Failed to compact thread",
      ),
    [WS_METHODS.providerListCommands]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.listCommands(input),
        "Failed to list commands",
      ),
    [WS_METHODS.providerListSkills]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.listSkills(input),
        "Failed to list skills",
      ),
    [WS_METHODS.providerListSkillsCatalog]: (input) =>
      dependencies.rpcEffect(
        Effect.tryPromise(() =>
          discoverSkillsCatalog({
            cwd: input.cwd ?? null,
            homeDir: dependencies.config.homeDir,
            agentGroupBaseDir: dependencies.config.baseDir,
            includeDuplicateOrigins: true,
          }),
        ).pipe(
          Effect.map((skills) => ({
            skills,
            agentGroupSkillsDir: agentGroupSkillsDir(dependencies.config.baseDir),
          })),
        ),
        "Failed to list the skills catalog",
      ),
    [WS_METHODS.providerListPlugins]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.listPlugins(input),
        "Failed to list plugins",
      ),
    [WS_METHODS.providerReadPlugin]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.readPlugin(input),
        "Failed to read plugin",
      ),
    [WS_METHODS.providerListModels]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.listModels(input),
        "Failed to list models",
      ),
    [WS_METHODS.providerListAgents]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerDiscoveryService.listAgents(input),
        "Failed to list agents",
      ),
    [WS_METHODS.automationList]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.list(input),
        "Failed to list automations",
      ),
    [WS_METHODS.automationCreate]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.create(input),
        "Failed to create automation",
      ),
    [WS_METHODS.automationUpdate]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.update(input),
        "Failed to update automation",
      ),
    [WS_METHODS.automationDelete]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.delete(input),
        "Failed to delete automation",
      ),
    [WS_METHODS.automationRunNow]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.runNow(input),
        "Failed to run automation",
      ),
    [WS_METHODS.automationCancelRun]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.cancelRun(input),
        "Failed to cancel automation run",
      ),
    [WS_METHODS.automationMarkRunRead]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.markRunRead(input),
        "Failed to update automation run",
      ),
    [WS_METHODS.automationArchiveRun]: (input) =>
      dependencies.rpcEffect(
        dependencies.automationService.archiveRun(input),
        "Failed to update automation run",
      ),
    [WS_METHODS.subscribeAutomationEvents]: () =>
      Stream.merge(
        Stream.fromEffect(
          dependencies.automationService.list({}).pipe(
            Effect.map(({ definitions, runs }) => ({
              type: "snapshot" as const,
              definitions,
              runs,
            })),
          ),
        ),
        dependencies.automationService.streamEvents,
      ).pipe(Stream.mapError((cause) => toWsRpcError(cause, "Automation event stream failed"))),
  } satisfies Partial<WsRpcHandlers>;
}
