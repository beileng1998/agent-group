// FILE: appSettings.ts
// Purpose: Preserve the public settings API while domain owners live in focused modules.
// Layer: Web settings compatibility facade

export {
  AppSettingsSchema,
  DEFAULT_CHAT_FONT_SIZE_PX,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  DEFAULT_TIMESTAMP_FORMAT,
  DEFAULT_UI_DENSITY,
  getDefaultNativeFontSmoothing,
  MAX_CHAT_FONT_SIZE_PX,
  MAX_CUSTOM_MODEL_LENGTH,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TERMINAL_FONT_FAMILY_SUGGESTIONS,
  TimestampFormat,
  UiDensity,
} from "./appSettingsSchema";
export type { AppSettings } from "./appSettingsSchema";

export {
  CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  MODEL_PROVIDER_SETTINGS,
  normalizeCustomModelSlugs,
  patchCustomModels,
} from "./appCustomModels";
export type { ProviderCustomModelConfig } from "./appCustomModels";

export {
  getAppModelOptions,
  getCustomModelOptionsByProvider,
  getGitTextGenerationModelOptions,
  mapCatalogModelOptionsToAppModelOptions,
  resolveAppModelSelection,
} from "./appModelOptions";
export type { AppModelOption } from "./appModelOptions";

export {
  normalizeChatFontSizePx,
  normalizeStoredAppSettings,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSizePx,
  resolveTerminalFontFamilyStack,
} from "./appSettingsNormalization";

export {
  getCustomBinaryPathForProvider,
  getProviderStartOptions,
  resolveAssistantDeliveryMode,
} from "./appProviderOptions";

export { useAppSettings } from "./useAppSettings";
