import type { AppSettings } from "../appSettings";
import { sameProviderOrder } from "../providerOrdering";

function hasCustomModels(settings: AppSettings): boolean {
  return (
    settings.customCodexModels.length > 0 ||
    settings.customClaudeModels.length > 0 ||
    settings.customCursorModels.length > 0 ||
    settings.customAntigravityModels.length > 0 ||
    settings.customGrokModels.length > 0 ||
    settings.customDroidModels.length > 0 ||
    settings.customKiloModels.length > 0 ||
    settings.customOpenCodeModels.length > 0 ||
    settings.customPiModels.length > 0
  );
}

function hasInstallOverrides(settings: AppSettings, defaults: AppSettings): boolean {
  return (
    settings.claudeBinaryPath !== defaults.claudeBinaryPath ||
    settings.cursorBinaryPath !== defaults.cursorBinaryPath ||
    settings.cursorApiEndpoint !== defaults.cursorApiEndpoint ||
    settings.antigravityBinaryPath !== defaults.antigravityBinaryPath ||
    settings.grokBinaryPath !== defaults.grokBinaryPath ||
    settings.droidBinaryPath !== defaults.droidBinaryPath ||
    settings.kiloBinaryPath !== defaults.kiloBinaryPath ||
    settings.kiloServerUrl !== defaults.kiloServerUrl ||
    settings.kiloServerPassword !== defaults.kiloServerPassword ||
    settings.codexBinaryPath !== defaults.codexBinaryPath ||
    settings.codexHomePath !== defaults.codexHomePath ||
    settings.openCodeBinaryPath !== defaults.openCodeBinaryPath ||
    settings.openCodeExperimentalWebSockets !== defaults.openCodeExperimentalWebSockets ||
    settings.openCodeServerUrl !== defaults.openCodeServerUrl ||
    settings.openCodeServerPassword !== defaults.openCodeServerPassword ||
    settings.piBinaryPath !== defaults.piBinaryPath ||
    settings.piAgentDir !== defaults.piAgentDir
  );
}

export function changedSettingsLabels(input: {
  settings: AppSettings;
  defaults: AppSettings;
  theme: string;
  resolvedTheme: "dark" | "light";
  isDefaultActiveTheme: boolean;
  shouldShowFontSmoothing: boolean;
}): string[] {
  const { settings, defaults } = input;
  return [
    ...(input.theme !== "system" ? ["Theme"] : []),
    ...(!input.isDefaultActiveTheme
      ? [`${input.resolvedTheme === "dark" ? "Dark" : "Light"} theme pack`]
      : []),
    ...(settings.uiDensity !== defaults.uiDensity ? ["UI density"] : []),
    ...(settings.chatFontSizePx !== defaults.chatFontSizePx ? ["Base font size"] : []),
    ...(settings.terminalFontSizePx !== defaults.terminalFontSizePx ? ["Terminal font size"] : []),
    ...(settings.terminalFontFamily !== defaults.terminalFontFamily ? ["Terminal font"] : []),
    ...(input.shouldShowFontSmoothing &&
    settings.enableNativeFontSmoothing !== defaults.enableNativeFontSmoothing
      ? ["Font smoothing"]
      : []),
    ...(settings.timestampFormat !== defaults.timestampFormat ? ["Time format"] : []),
    ...(settings.enableTaskCompletionToasts !== defaults.enableTaskCompletionToasts
      ? ["Activity toasts"]
      : []),
    ...(settings.enableSystemTaskCompletionNotifications !==
    defaults.enableSystemTaskCompletionNotifications
      ? ["Desktop notifications"]
      : []),
    ...(settings.enableAssistantStreaming !== defaults.enableAssistantStreaming
      ? ["Assistant output"]
      : []),
    ...(settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.diffWordWrap !== defaults.diffWordWrap ? ["Diff line wrapping"] : []),
    ...(settings.confirmTerminalTabClose !== defaults.confirmTerminalTabClose
      ? ["Terminal close confirmation"]
      : []),
    ...(hasCustomModels(settings) ? ["Custom models"] : []),
    ...(hasInstallOverrides(settings, defaults) ? ["Provider installs"] : []),
    ...(settings.hiddenProviders.length > 0 ? ["Provider visibility"] : []),
    ...(!sameProviderOrder(settings.providerOrder, defaults.providerOrder)
      ? ["Provider order"]
      : []),
  ];
}
