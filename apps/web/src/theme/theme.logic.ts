// Compatibility facade for the public theme-domain API.

export {
  CODE_THEME_OPTIONS,
  DEFAULT_CHROME_THEME_BY_VARIANT,
  getAvailableCodeThemes,
  isCodeThemeAvailable,
  isThemeMode,
  isThemeVariant,
  resolveThemeVariant,
} from "./themeCatalog";
export { buildThemeCssVariables } from "./themeCssVariables";
export {
  normalizeChromeTheme,
  normalizeSemanticColors,
  normalizeThemeFonts,
} from "./themeNormalization";
export { buildResolvedThemeTokens } from "./themeResolvedTokens";
export { getCodeThemeSeed, getCodeThemeSeedPatch } from "./themeSeeds";
export {
  canParseThemeShareString,
  createThemeShareString,
  getThemeSharePrefix,
  parseThemeShareString,
  parseThemeShareStringForVariant,
  updateThemePackFromShareString,
} from "./themeShare";
export {
  DEFAULT_THEME_STATE,
  areThemePacksEqual,
  normalizeCodeThemeId,
  normalizeThemePack,
  normalizeThemeState,
  parseStoredThemeState,
  resetThemeVariant,
  resolveThemePack,
  serializeThemeState,
  setThemeCodeThemeId,
  setThemeFonts,
  updateChromeTheme,
} from "./themeState";
export type {
  ChromeTheme,
  CodeThemeOption,
  ResolvedThemeTokens,
  ThemeCssVariableBuild,
  ThemeDerivedTokens,
  ThemeFonts,
  ThemeMode,
  ThemePack,
  ThemeSemanticColors,
  ThemeSharePayload,
  ThemeState,
  ThemeVariant,
  WindowMaterial,
} from "./themeTypes";
