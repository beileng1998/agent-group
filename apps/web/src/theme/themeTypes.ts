export type ThemeMode = "light" | "dark" | "system";
export type ThemeVariant = "light" | "dark";
export type WindowMaterial = "opaque" | "translucent";

export interface ThemeFonts {
  ui: string | null;
  code: string | null;
}

export interface ThemeSemanticColors {
  diffAdded: string;
  diffRemoved: string;
  skill: string;
}

export interface ChromeTheme {
  accent: string;
  contrast: number;
  fonts: ThemeFonts;
  ink: string;
  opaqueWindows: boolean;
  semanticColors: ThemeSemanticColors;
  surface: string;
}

export interface ThemePack {
  codeThemeId: string;
  theme: ChromeTheme;
}

export interface ThemeState {
  chromeThemes: Record<ThemeVariant, ChromeTheme>;
  codeThemeIds: Record<ThemeVariant, string>;
  mode: ThemeMode;
  /** Ignore the theme pack's custom UI font and let the native system stack apply. */
  systemUiFont: boolean;
}

export interface CodeThemeOption {
  id: string;
  label: string;
  variants: readonly ThemeVariant[];
}

export interface ThemeSharePayload {
  codeThemeId: string;
  theme: ChromeTheme;
  variant: ThemeVariant;
}

export interface ThemeCssVariableBuild {
  material: WindowMaterial;
  variables: Record<string, string>;
}

export interface ThemeDerivedTokens {
  accentBackground: string;
  accentBackgroundActive: string;
  accentBackgroundHover: string;
  border: string;
  borderFocus: string;
  borderHeavy: string;
  borderLight: string;
  buttonPrimaryBackground: string;
  buttonPrimaryBackgroundActive: string;
  buttonPrimaryBackgroundHover: string;
  buttonPrimaryBackgroundInactive: string;
  buttonSecondaryBackground: string;
  buttonSecondaryBackgroundActive: string;
  buttonSecondaryBackgroundHover: string;
  buttonSecondaryBackgroundInactive: string;
  buttonTertiaryBackground: string;
  buttonTertiaryBackgroundActive: string;
  buttonTertiaryBackgroundHover: string;
  controlBackground: string;
  controlBackgroundOpaque: string;
  elevatedPrimary: string;
  elevatedPrimaryOpaque: string;
  elevatedSecondary: string;
  elevatedSecondaryOpaque: string;
  iconAccent: string;
  iconPrimary: string;
  iconSecondary: string;
  iconTertiary: string;
  simpleScrim: string;
  textAccent: string;
  textButtonPrimary: string;
  textButtonSecondary: string;
  textButtonTertiary: string;
  textForeground: string;
  textForegroundSecondary: string;
  textForegroundTertiary: string;
}

export interface ResolvedThemeTokens {
  aliases: Record<string, string>;
  codexVariables: Record<string, string>;
  computed: {
    contrast: number;
    editorBackground: string;
    panel: string;
    surfaceUnder: string;
  };
  derived: ThemeDerivedTokens;
}
