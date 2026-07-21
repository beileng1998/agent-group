import type { ProviderKind, ProviderPluginDescriptor } from "@agent-group/contracts";
import type { IconType } from "react-icons";
import {
  SiCanva,
  SiFigma,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiHuggingface,
  SiLinear,
  SiNotion,
  SiSlack,
  SiStripe,
  SiVercel,
} from "react-icons/si";

type PluginBrandArtwork = {
  color: string;
  icon: IconType;
};

const KNOWN_PLUGIN_BRANDS: Record<string, PluginBrandArtwork> = {
  canva: { icon: SiCanva, color: "#00C4CC" },
  figma: { icon: SiFigma, color: "#F24E1E" },
  github: { icon: SiGithub, color: "#181717" },
  gmail: { icon: SiGmail, color: "#EA4335" },
  googlecalendar: { icon: SiGooglecalendar, color: "#4285F4" },
  googledrive: { icon: SiGoogledrive, color: "#0F9D58" },
  huggingface: { icon: SiHuggingface, color: "#FF9D00" },
  linear: { icon: SiLinear, color: "#5E6AD2" },
  notion: { icon: SiNotion, color: "#111111" },
  slack: { icon: SiSlack, color: "#4A154B" },
  stripe: { icon: SiStripe, color: "#635BFF" },
  vercel: { icon: SiVercel, color: "#111111" },
};

export const PROVIDER_DISCOVERY_ORDER: ReadonlyArray<ProviderKind> = [
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
];

export function pluginEntryKey(entry: {
  marketplacePath: string;
  plugin: ProviderPluginDescriptor;
}): string {
  return `${entry.marketplacePath}::${entry.plugin.name}`;
}

export function sectionTitle(value: string): string {
  const normalized = value.trim();
  return normalized.length === 0 ? "Unknown" : normalized;
}

export function resolvePluginAccent(plugin: ProviderPluginDescriptor): string | undefined {
  return plugin.interface?.brandColor?.trim() || undefined;
}

export function resolvePluginLogo(plugin: ProviderPluginDescriptor): string | undefined {
  return plugin.interface?.logo?.trim() || undefined;
}

function normalizeBrandKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function resolvePluginBrand(
  plugin: ProviderPluginDescriptor,
): PluginBrandArtwork | undefined {
  const candidates = [
    plugin.interface?.composerIcon,
    plugin.interface?.displayName,
    plugin.name,
  ].map(normalizeBrandKey);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const knownBrand = KNOWN_PLUGIN_BRANDS[candidate];
    if (knownBrand) return knownBrand;
  }

  return undefined;
}

export function nameToHue(name: string): number {
  let hue = 0;
  for (let index = 0; index < name.length; index++) {
    hue = name.charCodeAt(index) + ((hue << 5) - hue);
  }
  return Math.abs(hue) % 360;
}
