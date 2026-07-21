import { isCodeThemeAvailable, isThemeVariant } from "./themeCatalog";
import {
  isRecord,
  normalizeChromeTheme,
  normalizeFontSelection,
  normalizeHexColor,
} from "./themeNormalization";
import type {
  ChromeTheme,
  ThemeFonts,
  ThemePack,
  ThemeSemanticColors,
  ThemeSharePayload,
  ThemeState,
  ThemeVariant,
} from "./themeTypes";

const THEME_SHARE_PREFIX = "codex-theme-v1:";

export function getThemeSharePrefix(): string {
  return THEME_SHARE_PREFIX;
}

export function createThemeShareString(variant: ThemeVariant, pack: ThemePack): string {
  return `${THEME_SHARE_PREFIX}${JSON.stringify({
    codeThemeId: pack.codeThemeId,
    theme: pack.theme,
    variant,
  })}`;
}

export function parseThemeShareString(rawValue: string): ThemeSharePayload {
  const value = rawValue.trim();
  if (!value.startsWith(THEME_SHARE_PREFIX)) {
    throw new Error("Theme share string must start with codex-theme-v1:");
  }

  const payloadText = value.slice(THEME_SHARE_PREFIX.length);
  const jsonText = payloadText.startsWith("{") ? payloadText : decodeURIComponent(payloadText);
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error("Theme share string does not contain valid JSON.");
  }

  const themeShare = parseThemeSharePayload(payload);
  if (!isCodeThemeAvailable(themeShare.codeThemeId, themeShare.variant)) {
    throw new Error(
      `Code theme "${themeShare.codeThemeId}" is not available for ${themeShare.variant}.`,
    );
  }

  return {
    codeThemeId: themeShare.codeThemeId,
    theme: normalizeChromeTheme(themeShare.theme, themeShare.variant),
    variant: themeShare.variant,
  };
}

export function canParseThemeShareString(value: string, targetVariant?: ThemeVariant): boolean {
  try {
    parseThemeShareStringForVariant(value, targetVariant);
    return true;
  } catch {
    return false;
  }
}

export function parseThemeShareStringForVariant(
  value: string,
  targetVariant?: ThemeVariant,
): ThemeSharePayload {
  const payload = parseThemeShareString(value);
  if (targetVariant && payload.variant !== targetVariant) {
    throw new Error(
      `Theme variant mismatch. Expected ${targetVariant}, received ${payload.variant}.`,
    );
  }
  return payload;
}

export function updateThemePackFromShareString(
  state: ThemeState,
  value: string,
  targetVariant: ThemeVariant,
): ThemeState {
  const payload = parseThemeShareStringForVariant(value, targetVariant);
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [targetVariant]: payload.theme,
    },
    codeThemeIds: {
      ...state.codeThemeIds,
      [targetVariant]: payload.codeThemeId,
    },
  };
}

function parseThemeSharePayload(value: unknown): ThemeSharePayload {
  if (!isRecord(value)) {
    throw new Error("Theme share payload must be an object.");
  }

  const codeThemeId = normalizeRequiredString(value.codeThemeId, "Theme share codeThemeId");
  const variant = value.variant;
  if (!isThemeVariant(variant)) {
    throw new Error("Theme share variant must be either light or dark.");
  }

  const theme = parseStrictChromeTheme(value.theme);
  return {
    codeThemeId: codeThemeId.toLowerCase(),
    theme,
    variant,
  };
}

function parseStrictChromeTheme(value: unknown): ChromeTheme {
  if (!isRecord(value)) {
    throw new Error("Theme share theme must be an object.");
  }

  return {
    accent: parseRequiredHexColor(value.accent, "Theme accent"),
    contrast: parseRequiredContrast(value.contrast),
    fonts: parseStrictThemeFonts(value.fonts),
    ink: parseRequiredHexColor(value.ink, "Theme ink"),
    opaqueWindows: parseRequiredBoolean(value.opaqueWindows, "Theme opaqueWindows"),
    semanticColors: parseStrictSemanticColors(value.semanticColors),
    surface: parseRequiredHexColor(value.surface, "Theme surface"),
  };
}

function parseStrictThemeFonts(value: unknown): ThemeFonts {
  if (!isRecord(value)) {
    throw new Error("Theme fonts must be an object.");
  }

  return {
    code: parseNullableString(value.code, "Theme code font"),
    ui: parseNullableString(value.ui, "Theme UI font"),
  };
}

function parseStrictSemanticColors(value: unknown): ThemeSemanticColors {
  if (!isRecord(value)) {
    throw new Error("Theme semanticColors must be an object.");
  }

  return {
    diffAdded: parseRequiredHexColor(value.diffAdded, "Theme diffAdded"),
    diffRemoved: parseRequiredHexColor(value.diffRemoved, "Theme diffRemoved"),
    skill: parseRequiredHexColor(value.skill, "Theme skill"),
  };
}

function parseRequiredContrast(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Theme contrast must be an integer between 0 and 100.");
  }
  return value;
}

function parseRequiredBoolean(value: unknown, label: string): boolean {
  if (value !== true && value !== false) {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function parseNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
  return normalizeFontSelection(value);
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return trimmedValue;
}

function parseRequiredHexColor(value: unknown, label: string): string {
  const normalizedColor = normalizeHexColor(value);
  if (!normalizedColor) {
    throw new Error(`${label} must be a 6-digit hex color.`);
  }
  return normalizedColor;
}
