// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

export const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "access",
  "behavior",
  "appsnap",
  "shortcuts",
  "worktrees",
  "archived",
  "agent-group",
  "models",
  "providers",
  "skills",
  "usage",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "agent-group";

/**
 * Deep-link scroll targets inside a settings panel. Each id is shared by the element that owns
 * it (its `id` + scroll ref), the panel effect that scrolls it into view, and any caller that
 * navigates to it via `?target=…`. Centralizing them keeps the anchor and its links from
 * silently drifting apart.
 */
export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  providerInstalls: "provider-installs",
  environmentPanel: "environment-panel",
} as const;

export type SettingsTargetId = (typeof SETTINGS_TARGETS)[keyof typeof SETTINGS_TARGETS];

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;
  /** Basename of a SVG under `/central-icons-reversed`. */
  icon: string;
  eyebrow: string;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> = [
  { id: "app", label: "Preferences" },
  { id: "agent-group", label: "Agents & runtime" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Theme, typography, and timestamp formatting.",
    icon: "color-palette",
    eyebrow: "Visual language",
  },
  {
    id: "notifications",
    group: "app",
    label: "Notifications",
    description: "In-app toasts and desktop alerts.",
    icon: "bell",
    eyebrow: "Alerts",
  },
  {
    id: "access",
    group: "app",
    label: "Mobile Access",
    description: "Private Tailnet access, device pairing, and revocation.",
    icon: "devices",
    eyebrow: "Remote control",
  },
  {
    id: "behavior",
    group: "app",
    label: "Runtime",
    description: "Streaming, diff handling, and terminal safety.",
    icon: "settings-slider-hor",
    eyebrow: "Runtime behavior",
  },
  {
    id: "shortcuts",
    group: "app",
    label: "Keyboard Shortcuts",
    description: "Every keyboard shortcut available in Agent Group, grouped by context.",
    icon: "shortcut",
    eyebrow: "Key bindings",
  },
  {
    id: "agent-group",
    group: "agent-group",
    label: "Agent Group",
    description: "Shared defaults, Context templates, prompt assembly, and rules.",
    icon: "prompt",
    eyebrow: "Group defaults",
  },
  {
    id: "providers",
    group: "agent-group",
    label: "Providers",
    description: "Choose visible providers, review CLI installs, and update provider tools.",
    icon: "puzzle",
    eyebrow: "Picker visibility",
  },
  {
    id: "skills",
    group: "agent-group",
    label: "Skills",
    description: "Every skill found across providers, with toggles to control availability.",
    icon: "building-blocks",
    eyebrow: "Agent skills",
  },
  {
    id: "usage",
    group: "agent-group",
    label: "Usage",
    description: "Remaining quota and credits for each signed-in provider.",
    icon: "gauge",
    eyebrow: "Limits & credits",
  },
  {
    id: "advanced",
    group: "agent-group",
    label: "Advanced",
    description: "Keybindings, recovery, and version info.",
    icon: "toolbox",
    eyebrow: "System tools",
  },
] as const;

/**
 * Stable DOM id for a settings row, derived from its (string) title. Shared by the row that
 * renders the anchor and by the search index that deep-links to it via `?target=…`, so the
 * two can't drift. Panels mount one section at a time, so the slug only needs to be unique
 * within a section.
 */
export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") return "appearance";
  return SETTINGS_NAV_ITEMS.find((item) => item.id === value)?.id ?? "appearance";
}

export function isVisibleSettingsSection(section: SettingsSectionId): boolean {
  return SETTINGS_NAV_ITEMS.some((item) => item.id === section);
}
