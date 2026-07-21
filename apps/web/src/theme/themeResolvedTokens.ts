import { formatOpaqueRgb, formatRgba, mixHex, parseHexColor } from "./themeColorMath";
import {
  buildComputedTheme,
  buildDerivedTokens,
  buildPanelBackground,
  type ComputedTheme,
} from "./themeDerivedTokens";
import type {
  ResolvedThemeTokens,
  ThemeDerivedTokens,
  ThemePack,
  ThemeVariant,
} from "./themeTypes";

export const WARNING_COLOR_BY_VARIANT: Record<ThemeVariant, string> = {
  dark: "#f5b44a",
  light: "#d97706",
};

export function buildResolvedThemeTokens(
  pack: ThemePack,
  variant: ThemeVariant,
): ResolvedThemeTokens {
  const computedTheme = buildComputedTheme(pack.theme, variant);
  const derived = buildDerivedTokens(computedTheme);
  const panel = buildPanelBackground(computedTheme);
  const codexVariables = buildCodexCssVariables(computedTheme, derived, panel);

  return {
    aliases: buildThemeTokenAliases(codexVariables),
    codexVariables,
    computed: {
      contrast: computedTheme.contrast,
      editorBackground: formatOpaqueRgb(computedTheme.editorBackground),
      panel,
      surfaceUnder: computedTheme.surfaceUnder,
    },
    derived,
  };
}

function buildCodexCssVariables(
  theme: ComputedTheme,
  derivedTokens: ThemeDerivedTokens,
  panelBackground: string,
) {
  const terminalAnsiGreen = buildTerminalAnsiGreen(theme.theme.semanticColors.diffAdded);

  return {
    "--codex-base-accent": theme.theme.accent,
    "--codex-base-contrast": String(theme.theme.contrast),
    "--codex-base-ink": theme.theme.ink,
    "--codex-base-surface": theme.theme.surface,
    "--color-accent-blue": theme.theme.accent,
    "--color-accent-green": theme.theme.semanticColors.diffAdded,
    "--color-accent-red": theme.theme.semanticColors.diffRemoved,
    "--color-accent-purple": theme.theme.semanticColors.skill,
    "--color-accent-yellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--color-background-accent": derivedTokens.accentBackground,
    "--color-background-accent-active": derivedTokens.accentBackgroundActive,
    "--color-background-accent-hover": derivedTokens.accentBackgroundHover,
    "--color-background-button-primary": derivedTokens.buttonPrimaryBackground,
    "--color-background-button-primary-active": derivedTokens.buttonPrimaryBackgroundActive,
    "--color-background-button-primary-hover": derivedTokens.buttonPrimaryBackgroundHover,
    "--color-background-button-primary-inactive": derivedTokens.buttonPrimaryBackgroundInactive,
    "--color-background-button-secondary": derivedTokens.buttonSecondaryBackground,
    "--color-background-button-secondary-active": derivedTokens.buttonSecondaryBackgroundActive,
    "--color-background-button-secondary-hover": derivedTokens.buttonSecondaryBackgroundHover,
    "--color-background-button-secondary-inactive": derivedTokens.buttonSecondaryBackgroundInactive,
    "--color-background-button-tertiary": derivedTokens.buttonTertiaryBackground,
    "--color-background-button-tertiary-active": derivedTokens.buttonTertiaryBackgroundActive,
    "--color-background-button-tertiary-hover": derivedTokens.buttonTertiaryBackgroundHover,
    "--color-background-control": derivedTokens.controlBackground,
    "--color-background-control-opaque": derivedTokens.controlBackgroundOpaque,
    "--color-background-editor-opaque": formatOpaqueRgb(theme.editorBackground),
    "--color-background-elevated-primary": derivedTokens.elevatedPrimary,
    "--color-background-elevated-primary-opaque": derivedTokens.elevatedPrimaryOpaque,
    "--color-background-elevated-secondary": derivedTokens.elevatedSecondary,
    "--color-background-elevated-secondary-opaque": derivedTokens.elevatedSecondaryOpaque,
    "--color-background-panel": panelBackground,
    "--color-background-surface": theme.theme.surface,
    "--color-background-surface-under": theme.surfaceUnder,
    // The user message bubble has always reused the subtle secondary surface
    // (theme ink at ~4% over the background); keep it sourced from there.
    "--color-background-user-message": derivedTokens.buttonSecondaryBackground,
    "--color-border": derivedTokens.border,
    "--color-border-focus": derivedTokens.borderFocus,
    "--color-border-heavy": derivedTokens.borderHeavy,
    "--color-border-light": derivedTokens.borderLight,
    "--color-decoration-added": theme.theme.semanticColors.diffAdded,
    "--color-decoration-deleted": theme.theme.semanticColors.diffRemoved,
    "--color-editor-added": formatRgba(
      parseHexColor(theme.theme.semanticColors.diffAdded),
      theme.variant === "light" ? 0.15 : 0.23,
    ),
    "--color-editor-deleted": formatRgba(
      parseHexColor(theme.theme.semanticColors.diffRemoved),
      theme.variant === "light" ? 0.15 : 0.23,
    ),
    "--color-icon-accent": derivedTokens.iconAccent,
    "--color-icon-primary": derivedTokens.iconPrimary,
    "--color-icon-secondary": derivedTokens.iconSecondary,
    "--color-icon-tertiary": derivedTokens.iconTertiary,
    "--color-simple-scrim": derivedTokens.simpleScrim,
    "--color-text-accent": derivedTokens.textAccent,
    "--color-text-button-primary": derivedTokens.textButtonPrimary,
    "--color-text-button-secondary": derivedTokens.textButtonSecondary,
    "--color-text-button-tertiary": derivedTokens.textButtonTertiary,
    "--color-text-foreground": derivedTokens.textForeground,
    "--color-text-foreground-secondary": derivedTokens.textForegroundSecondary,
    "--color-text-foreground-tertiary": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlack": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlue": theme.theme.accent,
    "--vscode-terminal-ansiBrightBlack": derivedTokens.textForegroundSecondary,
    "--vscode-terminal-ansiBrightBlue": theme.theme.accent,
    "--vscode-terminal-ansiBrightCyan": theme.theme.accent,
    "--vscode-terminal-ansiBrightGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiBrightMagenta": theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiBrightRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiBrightWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiBrightYellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--vscode-terminal-ansiCyan": theme.theme.accent,
    "--vscode-terminal-ansiGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiMagenta": theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiYellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--vscode-terminal-background": theme.theme.surface,
    "--vscode-terminal-border": derivedTokens.border,
    "--vscode-terminal-foreground": derivedTokens.textForeground,
  };
}

function buildTerminalAnsiGreen(diffAddedColor: string): string {
  // Terminal success green should read calmer than diff decorations on a white shell.
  return mixHex(diffAddedColor, "#000000", 0.18);
}

function buildThemeTokenAliases(codexVariables: Record<string, string>): Record<string, string> {
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);

  return {
    "--color-token-badge-background": readCodexVariable("--color-background-accent"),
    "--color-token-badge-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-border": readCodexVariable("--color-border"),
    "--color-token-border-default": readCodexVariable("--color-border"),
    "--color-token-border-heavy": readCodexVariable("--color-border-heavy"),
    "--color-token-border-light": readCodexVariable("--color-border-light"),
    "--color-token-button-background": readCodexVariable("--color-background-button-primary"),
    "--color-token-button-border": readCodexVariable("--color-border"),
    "--color-token-button-foreground": readCodexVariable("--color-text-button-primary"),
    "--color-token-button-secondary-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-checkbox-active-background": readCodexVariable(
      "--color-background-accent-hover",
    ),
    "--color-token-checkbox-active-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-description-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-disabled-foreground": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-dropdown-background": readCodexVariable("--color-background-control-opaque"),
    "--color-token-focus-border": readCodexVariable("--color-border-focus"),
    "--color-token-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-background": readCodexVariable("--color-background-control"),
    "--color-token-input-border": readCodexVariable("--color-border"),
    "--color-token-input-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-placeholder-foreground": readCodexVariable(
      "--color-text-foreground-tertiary",
    ),
    "--color-token-link": readCodexVariable("--color-text-accent"),
    "--color-token-list-active-selection-background": readCodexVariable(
      "--color-background-button-secondary",
    ),
    "--color-token-list-active-selection-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-list-active-selection-icon-foreground":
      readCodexVariable("--color-icon-primary"),
    "--color-token-list-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-main-surface-primary": readCodexVariable("--color-background-surface"),
    "--color-token-menu-background": readCodexVariable("--color-background-elevated-primary"),
    "--color-token-menu-border": readCodexVariable("--color-border"),
    "--color-token-progress-bar-background": readCodexVariable("--color-background-accent"),
    "--color-token-radio-active-foreground": readCodexVariable("--color-icon-accent"),
    "--color-token-scrollbar-slider-active-background": readCodexVariable("--color-border-heavy"),
    "--color-token-scrollbar-slider-background": readCodexVariable("--color-border-light"),
    "--color-token-scrollbar-slider-hover-background": readCodexVariable("--color-border"),
    "--color-token-side-bar-background": readCodexVariable("--color-background-surface"),
    "--color-token-terminal-ansi-black": readCodexVariable("--vscode-terminal-ansiBlack"),
    "--color-token-terminal-ansi-blue": readCodexVariable("--vscode-terminal-ansiBlue"),
    "--color-token-terminal-ansi-bright-black": readCodexVariable(
      "--vscode-terminal-ansiBrightBlack",
    ),
    "--color-token-terminal-ansi-bright-blue": readCodexVariable(
      "--vscode-terminal-ansiBrightBlue",
    ),
    "--color-token-terminal-ansi-bright-cyan": readCodexVariable(
      "--vscode-terminal-ansiBrightCyan",
    ),
    "--color-token-terminal-ansi-bright-green": readCodexVariable(
      "--vscode-terminal-ansiBrightGreen",
    ),
    "--color-token-terminal-ansi-bright-magenta": readCodexVariable(
      "--vscode-terminal-ansiBrightMagenta",
    ),
    "--color-token-terminal-ansi-bright-red": readCodexVariable("--vscode-terminal-ansiBrightRed"),
    "--color-token-terminal-ansi-bright-white": readCodexVariable(
      "--vscode-terminal-ansiBrightWhite",
    ),
    "--color-token-terminal-ansi-bright-yellow": readCodexVariable(
      "--vscode-terminal-ansiBrightYellow",
    ),
    "--color-token-terminal-ansi-cyan": readCodexVariable("--vscode-terminal-ansiCyan"),
    "--color-token-terminal-ansi-green": readCodexVariable("--vscode-terminal-ansiGreen"),
    "--color-token-terminal-ansi-magenta": readCodexVariable("--vscode-terminal-ansiMagenta"),
    "--color-token-terminal-ansi-red": readCodexVariable("--vscode-terminal-ansiRed"),
    "--color-token-terminal-ansi-white": readCodexVariable("--vscode-terminal-ansiWhite"),
    "--color-token-terminal-ansi-yellow": readCodexVariable("--vscode-terminal-ansiYellow"),
    "--color-token-terminal-background": readCodexVariable("--vscode-terminal-background"),
    "--color-token-terminal-border": readCodexVariable("--vscode-terminal-border"),
    "--color-token-terminal-foreground": readCodexVariable("--vscode-terminal-foreground"),
    "--color-token-text-code-block-background": readCodexVariable(
      "--color-background-elevated-secondary-opaque",
    ),
    "--color-token-text-link-active-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-link-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-primary": readCodexVariable("--color-text-foreground"),
    "--color-token-text-secondary": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-text-tertiary": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-toolbar-hover-background": readCodexVariable(
      "--color-background-button-tertiary-hover",
    ),
    "--color-token-editor-background": readCodexVariable("--color-background-editor-opaque"),
    "--color-token-editor-foreground": readCodexVariable("--color-text-foreground"),
  };
}

export function getRequiredVariable(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (typeof value !== "string") {
    throw new Error(`Missing required theme variable: ${name}`);
  }
  return value;
}
