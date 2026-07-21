import type { ChromeTheme, CodeThemeOption, ThemeMode, ThemeVariant } from "./themeTypes";

export const DEFAULT_CODE_THEME_ID_BY_VARIANT: Record<ThemeVariant, string> = {
  dark: "codex",
  light: "codex",
};

// Mirror the packaged Codex catalog closely enough that share-string validation
// can preserve the "known theme + variant availability" behavior.
export const CODE_THEME_OPTIONS: readonly CodeThemeOption[] = [
  { id: "absolutely", label: "Absolutely", variants: ["light", "dark"] },
  { id: "ayu", label: "Ayu", variants: ["dark"] },
  { id: "catppuccin", label: "Catppuccin", variants: ["light", "dark"] },
  { id: "codex", label: "Codex", variants: ["light", "dark"] },
  { id: "agent-group", label: "Agent Group", variants: ["light", "dark"] },
  { id: "dracula", label: "Dracula", variants: ["dark"] },
  { id: "everforest", label: "Everforest", variants: ["light", "dark"] },
  { id: "github", label: "GitHub", variants: ["light", "dark"] },
  { id: "gruvbox", label: "Gruvbox", variants: ["light", "dark"] },
  { id: "linear", label: "Linear", variants: ["light", "dark"] },
  { id: "lobster", label: "Lobster", variants: ["dark"] },
  { id: "material", label: "Material", variants: ["dark"] },
  { id: "matrix", label: "Matrix", variants: ["dark"] },
  { id: "monokai", label: "Monokai", variants: ["dark"] },
  { id: "night-owl", label: "Night Owl", variants: ["dark"] },
  { id: "nord", label: "Nord", variants: ["dark"] },
  { id: "notion", label: "Notion", variants: ["light", "dark"] },
  { id: "one", label: "One", variants: ["light", "dark"] },
  { id: "oscurange", label: "Oscurange", variants: ["dark"] },
  { id: "proof", label: "Proof", variants: ["light"] },
  { id: "raycast", label: "Raycast", variants: ["light", "dark"] },
  { id: "rose-pine", label: "Rose Pine", variants: ["light", "dark"] },
  { id: "sentry", label: "Sentry", variants: ["dark"] },
  { id: "solarized", label: "Solarized", variants: ["light", "dark"] },
  { id: "temple", label: "Temple", variants: ["dark"] },
  { id: "tokyo-night", label: "Tokyo Night", variants: ["dark"] },
  { id: "vercel", label: "Vercel", variants: ["light", "dark"] },
  { id: "vscode-plus", label: "VS Code Plus", variants: ["light", "dark"] },
] as const;

export const DEFAULT_CHROME_THEME_BY_VARIANT: Record<ThemeVariant, ChromeTheme> = {
  dark: {
    accent: "#339cff",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#ffffff",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
    surface: "#181818",
  },
  light: {
    accent: "#339cff",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#1a1c1f",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#ba2623",
      skill: "#924ff7",
    },
    surface: "#ffffff",
  },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function isThemeVariant(value: unknown): value is ThemeVariant {
  return value === "light" || value === "dark";
}

export function getAvailableCodeThemes(variant: ThemeVariant): readonly CodeThemeOption[] {
  return CODE_THEME_OPTIONS.filter((option) => option.variants.includes(variant));
}

export function isCodeThemeAvailable(codeThemeId: string, variant: ThemeVariant): boolean {
  const normalizedCodeThemeId = codeThemeId.trim().toLowerCase();
  return CODE_THEME_OPTIONS.some(
    (option) => option.id === normalizedCodeThemeId && option.variants.includes(variant),
  );
}

export function resolveThemeVariant(mode: ThemeMode, systemDark: boolean): ThemeVariant {
  if (mode === "system") {
    return systemDark ? "dark" : "light";
  }
  return mode;
}
