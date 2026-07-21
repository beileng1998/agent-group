import { THEME_SEED_CATALOG } from "./theme.seed.generated";
import { DEFAULT_CHROME_THEME_BY_VARIANT } from "./themeCatalog";
import { normalizeChromeTheme } from "./themeNormalization";
import type { ChromeTheme, ThemeFonts, ThemeSemanticColors, ThemeVariant } from "./themeTypes";

export type ChromeThemeSeedPatch = Partial<
  Pick<ChromeTheme, "accent" | "contrast" | "ink" | "opaqueWindows" | "surface">
> & {
  fonts?: Partial<ThemeFonts>;
  semanticColors?: Partial<ThemeSemanticColors>;
};

type CodeThemeSeedPatchMetadata = {
  contrast?: true;
  fonts?: Partial<Record<keyof ThemeFonts, true>>;
  opaqueWindows?: true;
};

const CODE_THEME_SEED_PATCH_METADATA: Partial<
  Record<string, Partial<Record<ThemeVariant, CodeThemeSeedPatchMetadata>>>
> = {
  linear: {
    dark: { fonts: { ui: true }, opaqueWindows: true },
    light: { fonts: { ui: true }, opaqueWindows: true },
  },
  lobster: {
    dark: { fonts: { ui: true } },
  },
  matrix: {
    dark: { fonts: { code: true, ui: true }, opaqueWindows: true },
  },
  notion: {
    dark: { fonts: { code: true, ui: true }, opaqueWindows: true },
    light: { fonts: { code: true, ui: true }, opaqueWindows: true },
  },
  proof: {
    light: { fonts: { code: true, ui: true }, opaqueWindows: true },
  },
  raycast: {
    dark: { fonts: { code: true, ui: true }, opaqueWindows: true },
    light: { fonts: { code: true, ui: true }, opaqueWindows: true },
  },
  sentry: {
    dark: { fonts: { code: true, ui: true } },
  },
  vercel: {
    dark: { contrast: true, fonts: { code: true, ui: true }, opaqueWindows: true },
    light: { contrast: true, fonts: { code: true, ui: true }, opaqueWindows: true },
  },
  "agent-group": {
    dark: { contrast: true },
    light: { contrast: true },
  },
};

export function getCodeThemeSeed(codeThemeId: string, variant: ThemeVariant): ChromeTheme {
  const fallback = DEFAULT_CHROME_THEME_BY_VARIANT[variant];
  const themeSeed = THEME_SEED_CATALOG[codeThemeId]?.[variant];
  return themeSeed ? normalizeChromeTheme(themeSeed, variant) : fallback;
}

export function getCodeThemeSeedPatch(
  codeThemeId: string,
  variant: ThemeVariant,
): ChromeThemeSeedPatch {
  const themeSeed = THEME_SEED_CATALOG[codeThemeId]?.[variant];
  if (!themeSeed) {
    return {};
  }

  const normalizedSeed = normalizeChromeTheme(themeSeed, variant);
  const metadata = CODE_THEME_SEED_PATCH_METADATA[codeThemeId]?.[variant];
  const patch: ChromeThemeSeedPatch = {
    accent: normalizedSeed.accent,
    ink: normalizedSeed.ink,
    semanticColors: normalizedSeed.semanticColors,
    surface: normalizedSeed.surface,
  };

  if (metadata?.contrast) {
    patch.contrast = normalizedSeed.contrast;
  }

  if (metadata?.opaqueWindows) {
    patch.opaqueWindows = normalizedSeed.opaqueWindows;
  }

  if (metadata?.fonts) {
    const fontPatch: Partial<ThemeFonts> = {};
    if (metadata.fonts.code) {
      fontPatch.code = normalizedSeed.fonts.code;
    }
    if (metadata.fonts.ui) {
      fontPatch.ui = normalizedSeed.fonts.ui;
    }
    if (Object.keys(fontPatch).length > 0) {
      patch.fonts = fontPatch;
    }
  }

  return patch;
}

export function mergeThemeSeedPatch(
  currentTheme: ChromeTheme,
  seedPatch: ChromeThemeSeedPatch,
): ChromeThemeSeedPatch {
  return {
    ...currentTheme,
    ...seedPatch,
    fonts: seedPatch.fonts ? { ...currentTheme.fonts, ...seedPatch.fonts } : currentTheme.fonts,
    semanticColors: seedPatch.semanticColors
      ? { ...currentTheme.semanticColors, ...seedPatch.semanticColors }
      : currentTheme.semanticColors,
  };
}
