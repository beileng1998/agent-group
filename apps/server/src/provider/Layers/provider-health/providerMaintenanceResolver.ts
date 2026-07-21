import type { ProviderKind, ServerSettings } from "@agent-group/contracts";
import { Effect, FileSystem } from "effect";
import type { ServerSettingsShape } from "../../../serverSettings";
import { buildCursorAgentCommand } from "../../acp/CursorAcpCommand";
import {
  makeProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../../providerMaintenance";
import { PACKAGE_MANAGED_PROVIDER_UPDATES } from "./providerUpdateDefinitions";
import { isProviderEnabledForSettings } from "./providerStatusProjection";

function getProviderBinaryPath(provider: ProviderKind, settings: ServerSettings) {
  switch (provider) {
    case "codex":
      return settings.providers.codex.binaryPath;
    case "claudeAgent":
      return settings.providers.claudeAgent.binaryPath;
    case "cursor":
      return settings.providers.cursor.binaryPath;
    case "antigravity":
      return settings.providers.antigravity.binaryPath;
    case "grok":
      return settings.providers.grok.binaryPath;
    case "droid":
      return settings.providers.droid.binaryPath;
    case "kilo":
      return settings.providers.kilo.binaryPath;
    case "opencode":
      return settings.providers.opencode.binaryPath;
    case "pi":
      return settings.providers.pi.binaryPath;
  }
}

export function makeProviderMaintenanceCapabilitiesResolver(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly serverSettings: ServerSettingsShape;
}) {
  return Effect.fn("getProviderMaintenanceCapabilities")(function* (provider: ProviderKind) {
    const settings = yield* input.serverSettings.getSettings;
    if (!isProviderEnabledForSettings(provider, settings)) {
      return makeProviderMaintenanceCapabilities({
        provider,
        packageName: null,
        latestVersionSource: null,
        updateExecutable: null,
        updateArgs: [],
        updateLockKey: null,
      });
    }
    if (provider === "cursor") {
      const command = buildCursorAgentCommand(getProviderBinaryPath(provider, settings), [
        "update",
      ]);
      return makeProviderMaintenanceCapabilities({
        provider,
        packageName: null,
        updateExecutable: command.command,
        updateArgs: command.args,
        updateLockKey: "cursor-agent",
      });
    }
    const definition = PACKAGE_MANAGED_PROVIDER_UPDATES[provider];
    if (!definition) {
      return makeProviderMaintenanceCapabilities({
        provider,
        packageName: null,
        updateExecutable: null,
        updateArgs: [],
        updateLockKey: null,
      });
    }
    return yield* resolveProviderMaintenanceCapabilitiesEffect(definition, {
      binaryPath: getProviderBinaryPath(provider, settings),
      env: process.env,
      platform: process.platform,
    }).pipe(Effect.provideService(FileSystem.FileSystem, input.fileSystem));
  });
}
