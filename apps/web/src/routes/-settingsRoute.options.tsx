import {
  PROVIDER_DISPLAY_NAMES,
  type DesktopAppSnapPermission,
  type DesktopAppSnapState,
  type ProviderKind,
} from "@agent-group/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { UiDensity } from "../appSettings";
import { Switch } from "../components/ui/switch";
import { CentralIcon } from "../lib/central-icons";
import { DeviceLaptopIcon, MoonIcon, SunIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import { SETTINGS_RADIUS_CLASS_NAME } from "../settingsPanelStyles";

export const UI_DENSITY_OPTIONS = [
  {
    value: "compact",
    label: "Compact",
    description: "Tighter spacing in the sidebar, composer, and settings rows.",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Balanced spacing for everyday use.",
  },
  {
    value: "spacious",
    label: "Spacious",
    description: "More breathing room across the main workspace surfaces.",
  },
] as const satisfies ReadonlyArray<{
  value: UiDensity;
  label: string;
  description: string;
}>;

export const THEME_OPTIONS = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
    icon: <SunIcon />,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
    icon: <MoonIcon />,
  },
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
    icon: <DeviceLaptopIcon />,
  },
] as const;

export const PROVIDER_SELECT_OPTIONS = [
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "opencode",
  "kilo",
  "pi",
] as const satisfies readonly ProviderKind[];

export const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

export const SIDEBAR_PROJECT_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  created_at: "Recently added",
  manual: "Manual order",
} as const;

export const SIDEBAR_THREAD_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  created_at: "Newest first",
} as const;

export function isProviderSelectOption(value: string): value is ProviderKind {
  return PROVIDER_SELECT_OPTIONS.includes(value as ProviderKind);
}

export function appSnapStatusText(state: DesktopAppSnapState | null): string {
  if (!state) return "Available in the Agent Group desktop app";
  if (!state.supported) return state.message ?? "Available on macOS only";
  if (state.status === "ready") return "Listening — press both Option keys to snap";
  if (state.status === "disabled") return "Off";
  if (state.status === "starting") return "Starting the capture listener…";
  return state.message ?? "Permission setup required";
}

const APPSNAP_PERMISSION_LABELS: Record<DesktopAppSnapPermission, string> = {
  granted: "Granted",
  denied: "Denied",
  "not-determined": "Not requested yet",
  restricted: "Restricted",
  unknown: "Unknown",
};

export function AppSnapPermissionBadge({ permission }: { permission: DesktopAppSnapPermission }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          permission === "granted"
            ? "bg-emerald-500"
            : permission === "denied" || permission === "restricted"
              ? "bg-red-500"
              : "bg-[color:var(--color-border)]",
        )}
      />
      {APPSNAP_PERMISSION_LABELS[permission]}
    </span>
  );
}

export const PROVIDER_VISIBILITY_OPTIONS: ReadonlyArray<{
  provider: ProviderKind;
  title: string;
}> = [
  { provider: "codex", title: PROVIDER_DISPLAY_NAMES.codex },
  { provider: "claudeAgent", title: PROVIDER_DISPLAY_NAMES.claudeAgent },
  { provider: "cursor", title: PROVIDER_DISPLAY_NAMES.cursor },
  { provider: "antigravity", title: PROVIDER_DISPLAY_NAMES.antigravity },
  { provider: "grok", title: PROVIDER_DISPLAY_NAMES.grok },
  { provider: "droid", title: PROVIDER_DISPLAY_NAMES.droid },
  { provider: "kilo", title: PROVIDER_DISPLAY_NAMES.kilo },
  { provider: "opencode", title: PROVIDER_DISPLAY_NAMES.opencode },
  { provider: "pi", title: PROVIDER_DISPLAY_NAMES.pi },
];

export function setProviderHidden(
  current: ReadonlyArray<ProviderKind>,
  provider: ProviderKind,
  hidden: boolean,
): ProviderKind[] {
  const withoutTarget = current.filter((entry) => entry !== provider);
  return hidden ? [...withoutTarget, provider] : withoutTarget;
}

export function SortableProviderVisibilityRow(props: {
  option: { provider: ProviderKind; title: string };
  isHidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.option.provider });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        `flex items-center justify-between gap-3 ${SETTINGS_RADIUS_CLASS_NAME} border border-[color:var(--color-border)] bg-transparent px-3 py-2.5`,
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={cn(
            "inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground active:cursor-grabbing",
            SETTINGS_RADIUS_CLASS_NAME,
          )}
          aria-label={`Reorder ${props.option.title}`}
          {...attributes}
          {...listeners}
        >
          <CentralIcon name="dot-grid-2x3" className="size-4" />
        </button>
        <span className="min-w-0 text-sm text-foreground">{props.option.title}</span>
      </div>
      <Switch
        checked={!props.isHidden}
        onCheckedChange={(checked) => props.onHiddenChange(!Boolean(checked))}
        aria-label={`Show ${props.option.title} in the provider picker`}
      />
    </div>
  );
}
