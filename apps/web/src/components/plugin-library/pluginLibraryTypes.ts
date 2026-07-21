import type { ProviderKind, ProviderPluginDescriptor } from "@agent-group/contracts";

export type DiscoveryTab = "plugins" | "skills";

export type ProviderCapabilities = {
  plugins: boolean;
  skills: boolean;
};

export type PluginEntry = {
  marketplaceName: string;
  marketplacePath: string;
  plugin: ProviderPluginDescriptor;
  isFeatured: boolean;
};

export type MarketplaceSection = {
  key: string;
  title: string;
  entries: PluginEntry[];
};

export type ProviderCapabilitiesByKind = Record<ProviderKind, ProviderCapabilities>;
