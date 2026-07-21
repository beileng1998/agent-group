import {
  normalizeFontFamilyCssValue,
  normalizeMonospaceFontFamilyCssValue,
} from "../lib/fontFamily";
import { buildComposerFocusBorder } from "./themeDerivedTokens";
import {
  WARNING_COLOR_BY_VARIANT,
  buildResolvedThemeTokens,
  getRequiredVariable,
} from "./themeResolvedTokens";
import type { ThemeCssVariableBuild, ThemePack, ThemeVariant, WindowMaterial } from "./themeTypes";

export function buildThemeCssVariables(
  pack: ThemePack,
  variant: ThemeVariant,
  options?: { electron?: boolean; isMac?: boolean; systemUiFont?: boolean },
): ThemeCssVariableBuild {
  const resolvedTokens = buildResolvedThemeTokens(pack, variant);
  const codexVariables = resolvedTokens.codexVariables;
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);
  // The translucent shell relies on macOS window vibrancy as its backing
  // material. Windows/Linux have no equivalent, so a translucent shell there
  // leaves the transparent body and backdrop-filter surfaces bleeding through
  // and (on fractional DPI) rendering blurry. Restrict translucency to macOS.
  const material: WindowMaterial =
    options?.electron === true && options?.isMac === true && !pack.theme.opaqueWindows
      ? "translucent"
      : "opaque";
  const warningColor = WARNING_COLOR_BY_VARIANT[variant];
  // Codex paints the app sidebar with the PRIMARY surface (--color-background-surface,
  // mapped through --color-token-side-bar-background), not the darker "under" surface.
  // The under-surface is reserved for the window body behind the content (see
  // --app-shell-background / --background). Sourcing the sidebar from the primary
  // surface keeps its pure color matching Codex in both light and dark.
  const sidebarSurface = readCodexVariable("--color-background-surface");
  const sidebarRaisedSurface = readCodexVariable("--color-background-elevated-primary");
  const settingsSurface = readCodexVariable("--color-background-surface");
  const composerSurface =
    variant === "dark"
      ? readCodexVariable("--color-background-control-opaque")
      : "color-mix(in oklab, var(--color-background-control) 90%, transparent)";
  // Mirrors Codex Electron's [cmdk-root] dropdown shell: thin the dropdown-background
  // token by 5% in oklab over the existing backdrop blur. Light vs dark is already
  // handled by --color-background-control-opaque (white in light, dark control in dark).
  const composerPickerMenuSurface = "color-mix(in oklab, var(--popover) 70%, transparent)";
  const composerFocusBorder = buildComposerFocusBorder(
    pack,
    variant,
    resolvedTokens.computed.panel,
  );
  // Shared surface for the user message bubble and fenced code blocks so both
  // read as the same "input/source" affordance inside the transcript. Sourced
  // from the user-message token so code blocks pick up the bubble's color.
  const chatCodeSurface = readCodexVariable("--color-background-user-message");
  const appVariables: Record<string, string> = {
    "--accent": readCodexVariable("--color-background-accent"),
    "--accent-foreground": readCodexVariable("--color-text-foreground"),
    "--app-shell-background":
      material === "translucent"
        ? "transparent"
        : readCodexVariable("--color-background-surface-under"),
    "--app-composer-focus-border": composerFocusBorder,
    // Frosted blur only when the shell is translucent (macOS). On an opaque
    // shell these promote the surface to a GPU layer that Chromium rasterizes at
    // the wrong scale on fractional DPI (Windows), so text reads blurry until a
    // repaint. Keep them "none" off macOS.
    "--app-composer-backdrop-filter": material === "translucent" ? "blur(16px)" : "none",
    "--app-composer-picker-backdrop-filter": material === "translucent" ? "blur(32px)" : "none",
    "--app-composer-picker-surface": composerPickerMenuSurface,
    "--app-chat-code-surface": chatCodeSurface,
    "--app-user-message-background": chatCodeSurface,
    "--app-sidebar-backdrop-filter":
      material === "translucent" ? "blur(8px) saturate(135%)" : "none",
    // Settings mirrors the chat surface (opaque --color-background-surface) so every
    // settings element reads as outline-only. With an opaque page there is nothing to
    // frost, so we skip the backdrop blur (and its compositing cost) entirely.
    "--app-settings-backdrop-filter": "none",
    "--app-sidebar-shadow":
      material === "translucent"
        ? variant === "dark"
          ? "inset 0 1px 0 rgba(255,255,255,0.024)"
          : "inset 0 1px 0 rgba(0,0,0,0.025)"
        : variant === "dark"
          ? "inset 0 1px 0 rgba(255,255,255,0.025)"
          : "inset 0 1px 0 rgba(0,0,0,0.03)",
    "--app-sidebar-surface":
      material === "translucent"
        ? variant === "dark"
          ? `color-mix(in srgb, ${sidebarSurface} 72%, transparent)`
          : `color-mix(in srgb, ${sidebarSurface} 64%, transparent)`
        : sidebarSurface,
    // Always opaque so the settings page background matches the chat surface exactly,
    // regardless of window material.
    "--app-settings-surface": settingsSurface,
    "--background": readCodexVariable("--color-background-surface-under"),
    "--border": readCodexVariable("--color-border"),
    "--card": readCodexVariable("--color-background-panel"),
    "--card-foreground": readCodexVariable("--color-text-foreground"),
    "--composer-surface": composerSurface,
    "--destructive": pack.theme.semanticColors.diffRemoved,
    "--destructive-foreground": pack.theme.surface,
    "--foreground": readCodexVariable("--color-text-foreground"),
    "--info": pack.theme.accent,
    // Keep legacy app-level "info" consumers on Codex's accent-text path so
    // links, file labels, and similar affordances inherit the real light/dark logic.
    "--info-foreground": readCodexVariable("--color-text-accent"),
    "--input": readCodexVariable("--color-background-control-opaque"),
    "--muted": readCodexVariable("--color-background-elevated-secondary"),
    "--muted-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--popover": readCodexVariable("--color-background-elevated-primary-opaque"),
    "--popover-foreground": readCodexVariable("--color-text-foreground"),
    "--primary": readCodexVariable("--color-background-button-primary"),
    "--primary-foreground": readCodexVariable("--color-text-button-primary"),
    "--ring": readCodexVariable("--color-border-focus"),
    "--secondary": readCodexVariable("--color-background-button-secondary"),
    "--secondary-foreground": readCodexVariable("--color-text-button-secondary"),
    "--sidebar": readCodexVariable("--color-background-surface"),
    "--sidebar-accent": readCodexVariable("--color-background-button-secondary-hover"),
    "--sidebar-accent-active": readCodexVariable("--color-background-button-secondary-hover"),
    "--sidebar-accent-foreground": readCodexVariable("--color-text-foreground"),
    "--sidebar-border": readCodexVariable("--color-border"),
    "--sidebar-foreground": readCodexVariable("--color-text-foreground"),
    "--success": pack.theme.semanticColors.diffAdded,
    "--success-foreground": pack.theme.surface,
    "--theme-font-code-family": normalizeMonospaceFontFamilyCssValue(pack.theme.fonts.code) ?? "",
    // Empty string → the applier removes the property, so the base -apple-system stack
    // (SF Pro on macOS) takes over when the user prefers the native font.
    "--theme-font-ui-family": options?.systemUiFont
      ? ""
      : (normalizeFontFamilyCssValue(pack.theme.fonts.ui) ?? ""),
    "--warning": warningColor,
    "--warning-foreground": pack.theme.surface,
  };

  return {
    material,
    variables: {
      ...codexVariables,
      ...resolvedTokens.aliases,
      ...appVariables,
    },
  };
}
