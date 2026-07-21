import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@agent-group/contracts";
import React, { type ReactNode } from "react";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { CircleAlertIcon, HammerIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { DiscoveryTab, ProviderCapabilitiesByKind } from "./pluginLibraryTypes";
import { PROVIDER_DISCOVERY_ORDER } from "./pluginLibraryValues";

const PROVIDER_ICON: Record<ProviderKind, React.FC<React.SVGProps<SVGSVGElement>>> = {
  ...PROVIDER_ICON_COMPONENT_BY_PROVIDER,
  codex: HammerIcon,
};

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center border-b-2 px-1 text-[13px] font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground/80",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ProviderToggleButton({
  label,
  active,
  disabled,
  onClick,
  provider,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  provider: ProviderKind;
}) {
  const Icon = PROVIDER_ICON[provider] ?? HammerIcon;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-[var(--color-text-foreground)] text-[var(--color-background-surface)] shadow-xs"
          : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
        disabled && "pointer-events-none opacity-35",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </button>
  );
}

export function PluginLibraryTabs({
  selectedTab,
  onSelectTab,
}: {
  selectedTab: DiscoveryTab;
  onSelectTab: (tab: DiscoveryTab) => void;
}) {
  return (
    <div className="flex items-end gap-3">
      <TabButton
        label="Plugins"
        active={selectedTab === "plugins"}
        onClick={() => onSelectTab("plugins")}
      />
      <TabButton
        label="Skills"
        active={selectedTab === "skills"}
        onClick={() => onSelectTab("skills")}
      />
    </div>
  );
}

export function ProviderDiscoveryToggle({
  selectedProvider,
  providerCapabilities,
  onSelectProvider,
}: {
  selectedProvider: ProviderKind;
  providerCapabilities: ProviderCapabilitiesByKind;
  onSelectProvider: (provider: ProviderKind) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border/60 bg-background/60 p-0.5">
      {PROVIDER_DISCOVERY_ORDER.map((provider) => {
        const capabilities = providerCapabilities[provider];
        return (
          <ProviderToggleButton
            key={provider}
            label={PROVIDER_DISPLAY_NAMES[provider]}
            provider={provider}
            active={selectedProvider === provider}
            disabled={!capabilities.plugins && !capabilities.skills}
            onClick={() => onSelectProvider(provider)}
          />
        );
      })}
    </div>
  );
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/40 px-5 py-6 text-center">
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3 py-2.5 text-xs text-muted-foreground">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div>{children}</div>
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <h2 className="px-3 pb-1 pt-2 text-[15px] font-semibold text-foreground">{title}</h2>;
}
