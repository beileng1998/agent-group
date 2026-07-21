import type { SidebarSearchPaletteProps, ThemeCommandItem } from "./sidebarSearchTypes";

function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function hasTokenEqual(query: string, token: string): boolean {
  return queryTokens(query).includes(token);
}

function createThemeCommandItem(
  mode: ThemeCommandItem["mode"],
  activeMode: ThemeCommandItem["mode"],
): ThemeCommandItem {
  if (mode === "system") {
    return {
      id: "theme-command:system",
      label: "Switch to system theme",
      description: "Match your OS appearance setting.",
      mode,
      isActive: activeMode === mode,
    };
  }

  return {
    id: `theme-command:${mode}`,
    label: `Switch to ${mode} theme`,
    description: mode === "light" ? "Always use the light theme." : "Always use the dark theme.",
    mode,
    isActive: activeMode === mode,
  };
}

function hasTokenPrefixOf(query: string, keyword: string): boolean {
  return queryTokens(query).some((token) => token.length >= 2 && keyword.startsWith(token));
}

export function buildThemeCommandItems(input: {
  query: string;
  resolvedTheme: "light" | "dark";
  theme: "system" | "light" | "dark";
}): ThemeCommandItem[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  if (
    hasTokenEqual(normalizedQuery, "system") ||
    hasTokenEqual(normalizedQuery, "auto") ||
    hasTokenEqual(normalizedQuery, "automatic") ||
    hasTokenEqual(normalizedQuery, "os")
  ) {
    return [createThemeCommandItem("system", input.theme)];
  }

  if (hasTokenEqual(normalizedQuery, "light")) {
    return [
      createThemeCommandItem("light", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  if (hasTokenEqual(normalizedQuery, "dark")) {
    return [
      createThemeCommandItem("dark", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  if (
    hasTokenPrefixOf(normalizedQuery, "theme") ||
    hasTokenPrefixOf(normalizedQuery, "appearance")
  ) {
    const nextMode = input.resolvedTheme === "dark" ? "light" : "dark";
    return [
      createThemeCommandItem(nextMode, input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }

  return [];
}

export function expandHomeInPath(value: string, homeDir: string | null): string {
  if (!homeDir) return value;
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${homeDir}${value.slice(1)}`;
  }
  return value;
}

export function resolveSidebarActionHandler(
  actionId: string,
  props: Pick<
    SidebarSearchPaletteProps,
    "onCreateChat" | "onCreateThread" | "onOpenSettings" | "onOpenUsageSettings"
  >,
): (() => void) | null {
  switch (actionId) {
    case "new-chat":
      return props.onCreateChat;
    case "new-thread":
      return props.onCreateThread;
    case "settings":
      return props.onOpenSettings;
    case "usage-settings":
      return props.onOpenUsageSettings;
    default:
      return null;
  }
}

export function threadMatchLabel(input: {
  matchKind: "message" | "project" | "title";
  messageMatchCount: number;
}): string | null {
  if (input.matchKind === "message") {
    return input.messageMatchCount > 1 ? `${input.messageMatchCount} chat hits` : "Chat match";
  }
  if (input.matchKind === "project") return "Project match";
  return null;
}

export function importProviderLabel(provider: string): string {
  if (provider === "claudeAgent") return "Claude";
  if (provider === "cursor") return "Cursor";
  if (provider === "kilo") return "Kilo";
  if (provider === "opencode") return "OpenCode";
  return "Codex";
}

export function importFieldLabel(provider: string): string {
  return provider === "codex" ? "Thread ID" : "Session ID";
}

export function importPlaceholder(provider: string): string {
  if (provider === "claudeAgent") return "Paste a Claude session id";
  if (provider === "cursor") return "Paste a Cursor session id";
  if (provider === "kilo") return "Paste a Kilo session id";
  if (provider === "opencode") return "Paste an OpenCode session id";
  return "Paste a Codex thread id";
}

export function importDescription(provider: string): string {
  if (provider === "claudeAgent") return "Claude resumes a persisted session by session id.";
  if (provider === "cursor") return "Cursor resumes a persisted session by session id.";
  if (provider === "kilo") return "Kilo resumes a persisted session by session id.";
  if (provider === "opencode") return "OpenCode resumes a persisted session by session id.";
  return "Codex resumes a persisted thread by thread id.";
}
