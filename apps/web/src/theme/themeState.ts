import {
  DEFAULT_CODE_THEME_ID_BY_VARIANT,
  isCodeThemeAvailable,
  isThemeMode,
} from "./themeCatalog";
import { isRecord, normalizeChromeTheme, normalizeFontSelection } from "./themeNormalization";
import {
  getCodeThemeSeed,
  getCodeThemeSeedPatch,
  mergeThemeSeedPatch,
  type ChromeThemeSeedPatch,
} from "./themeSeeds";
import type { ChromeTheme, ThemeFonts, ThemePack, ThemeState, ThemeVariant } from "./themeTypes";

export const DEFAULT_THEME_STATE: ThemeState = {
  chromeThemes: {
    dark: getCodeThemeSeed(DEFAULT_CODE_THEME_ID_BY_VARIANT.dark, "dark"),
    light: getCodeThemeSeed(DEFAULT_CODE_THEME_ID_BY_VARIANT.light, "light"),
  },
  codeThemeIds: {
    dark: DEFAULT_CODE_THEME_ID_BY_VARIANT.dark,
    light: DEFAULT_CODE_THEME_ID_BY_VARIANT.light,
  },
  systemUiFont: true,
  mode: "system",
};

export function normalizeCodeThemeId(
  codeThemeId: unknown,
  variant: ThemeVariant,
  fallback = DEFAULT_THEME_STATE.codeThemeIds[variant],
): string {
  const normalizedCodeThemeId =
    typeof codeThemeId === "string" ? codeThemeId.trim().toLowerCase() : "";
  return isCodeThemeAvailable(normalizedCodeThemeId, variant) ? normalizedCodeThemeId : fallback;
}

export function normalizeThemePack(value: unknown, variant: ThemeVariant): ThemePack {
  const pack = isRecord(value) ? value : {};
  return {
    codeThemeId: normalizeCodeThemeId(pack.codeThemeId, variant),
    theme: normalizeChromeTheme(pack.theme, variant),
  };
}

function hasStoredCustomUiFont(state: Record<string, unknown>): boolean {
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const packs = isRecord(state.packs) ? state.packs : {};

  return (["dark", "light"] as const).some((variant) => {
    const chromeTheme = isRecord(chromeThemes[variant]) ? chromeThemes[variant] : {};
    const chromeFonts = isRecord(chromeTheme.fonts) ? chromeTheme.fonts : {};
    if (normalizeFontSelection(chromeFonts.ui) !== null) return true;

    const legacyPack = isRecord(packs[variant]) ? packs[variant] : {};
    const legacyTheme = isRecord(legacyPack.theme) ? legacyPack.theme : {};
    const legacyFonts = isRecord(legacyTheme.fonts) ? legacyTheme.fonts : {};
    return normalizeFontSelection(legacyFonts.ui) !== null;
  });
}

export function normalizeThemeState(value: unknown): ThemeState {
  const state = isRecord(value) ? value : {};
  const codeThemeIds = isRecord(state.codeThemeIds) ? state.codeThemeIds : {};
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const packs = isRecord(state.packs) ? state.packs : {};
  const legacyDarkPack = normalizeThemePack(packs.dark, "dark");
  const legacyLightPack = normalizeThemePack(packs.light, "light");
  return {
    chromeThemes: {
      dark: isRecord(chromeThemes.dark)
        ? normalizeChromeTheme(chromeThemes.dark, "dark")
        : isRecord(packs.dark)
          ? legacyDarkPack.theme
          : DEFAULT_THEME_STATE.chromeThemes.dark,
      light: isRecord(chromeThemes.light)
        ? normalizeChromeTheme(chromeThemes.light, "light")
        : isRecord(packs.light)
          ? legacyLightPack.theme
          : DEFAULT_THEME_STATE.chromeThemes.light,
    },
    codeThemeIds: {
      dark: normalizeCodeThemeId(codeThemeIds.dark ?? legacyDarkPack.codeThemeId, "dark"),
      light: normalizeCodeThemeId(codeThemeIds.light ?? legacyLightPack.codeThemeId, "light"),
    },
    mode: isThemeMode(state.mode) ? state.mode : DEFAULT_THEME_STATE.mode,
    // Preserve the UI font older theme states already rendered. New/default states use the
    // native stack, while an explicit preference always wins after the first save.
    systemUiFont:
      typeof state.systemUiFont === "boolean" ? state.systemUiFont : !hasStoredCustomUiFont(state),
  };
}

export function parseStoredThemeState(rawValue: string | null | undefined): ThemeState {
  if (!rawValue) {
    return DEFAULT_THEME_STATE;
  }
  if (isThemeMode(rawValue)) {
    return {
      ...DEFAULT_THEME_STATE,
      mode: rawValue,
    };
  }

  try {
    return normalizeThemeState(JSON.parse(rawValue));
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

export function serializeThemeState(state: ThemeState): string {
  return JSON.stringify(state);
}

export function updateChromeTheme(
  state: ThemeState,
  variant: ThemeVariant,
  patch: Partial<ChromeTheme>,
): ThemeState {
  const previousTheme = state.chromeThemes[variant];
  const nextPatch: ChromeThemeSeedPatch = { ...patch };
  if (patch.fonts) {
    nextPatch.fonts = patch.fonts;
  }
  if (patch.semanticColors) {
    nextPatch.semanticColors = patch.semanticColors;
  }
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: normalizeChromeTheme(mergeThemeSeedPatch(previousTheme, nextPatch), variant),
    },
  };
}

export function setThemeCodeThemeId(
  state: ThemeState,
  variant: ThemeVariant,
  codeThemeId: string,
): ThemeState {
  const normalized = normalizeCodeThemeId(codeThemeId, variant);
  const previousTheme = resolveThemePack(state, variant).theme;
  const nextTheme = normalizeChromeTheme(
    mergeThemeSeedPatch(previousTheme, getCodeThemeSeedPatch(normalized, variant)),
    variant,
  );
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: nextTheme,
    },
    codeThemeIds: {
      ...state.codeThemeIds,
      [variant]: normalized,
    },
  };
}

export function setThemeFonts(
  state: ThemeState,
  variant: ThemeVariant,
  patch: Partial<ThemeFonts>,
): ThemeState {
  const previousTheme = state.chromeThemes[variant];
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: normalizeChromeTheme(
        {
          ...previousTheme,
          fonts: { ...previousTheme.fonts, ...patch },
        },
        variant,
      ),
    },
  };
}

export function resetThemeVariant(state: ThemeState, variant: ThemeVariant): ThemeState {
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: DEFAULT_THEME_STATE.chromeThemes[variant],
    },
    codeThemeIds: {
      ...state.codeThemeIds,
      [variant]: DEFAULT_THEME_STATE.codeThemeIds[variant],
    },
  };
}

export function resolveThemePack(state: ThemeState, variant: ThemeVariant): ThemePack {
  return {
    codeThemeId: normalizeCodeThemeId(state.codeThemeIds[variant], variant),
    theme: normalizeChromeTheme(state.chromeThemes[variant], variant),
  };
}

export function areThemePacksEqual(left: ThemePack, right: ThemePack): boolean {
  return (
    left.codeThemeId === right.codeThemeId &&
    left.theme.accent === right.theme.accent &&
    left.theme.contrast === right.theme.contrast &&
    left.theme.fonts.code === right.theme.fonts.code &&
    left.theme.fonts.ui === right.theme.fonts.ui &&
    left.theme.ink === right.theme.ink &&
    left.theme.opaqueWindows === right.theme.opaqueWindows &&
    left.theme.semanticColors.diffAdded === right.theme.semanticColors.diffAdded &&
    left.theme.semanticColors.diffRemoved === right.theme.semanticColors.diffRemoved &&
    left.theme.semanticColors.skill === right.theme.semanticColors.skill &&
    left.theme.surface === right.theme.surface
  );
}
