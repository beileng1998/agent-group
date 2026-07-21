import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useFocusedChatContext } from "~/focusedChatContext";
import {
  buildPluginSearchFields,
  buildSkillSearchFields,
  isInstalledProviderPlugin,
  normalizeProviderDiscoveryText,
  rankProviderDiscoveryItems,
  resolveProviderDiscoveryCwd,
} from "~/lib/providerDiscovery";
import {
  providerComposerCapabilitiesQueryOptions,
  providerPluginsQueryOptions,
  providerSkillsQueryOptions,
  supportsPluginDiscovery,
  supportsSkillDiscovery,
} from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import { createFirstProjectSelector } from "~/storeSelectors";
import type {
  DiscoveryTab,
  MarketplaceSection,
  PluginEntry,
  ProviderCapabilitiesByKind,
} from "./pluginLibraryTypes";
import { PROVIDER_DISCOVERY_ORDER, sectionTitle } from "./pluginLibraryValues";

export function usePluginLibraryCatalog() {
  const firstProject = useStore(useMemo(() => createFirstProjectSelector(), []));
  const { activeProject: focusedProject, activeThread, focusedThreadId } = useFocusedChatContext();
  const activeProject = focusedProject ?? firstProject ?? null;
  const preferredProvider =
    activeThread?.modelSelection.provider ??
    activeProject?.defaultModelSelection?.provider ??
    "codex";

  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(preferredProvider);
  const [selectedTab, setSelectedTab] = useState<DiscoveryTab>("plugins");
  const [pluginSearch, setPluginSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const deferredPluginSearch = useDeferredValue(pluginSearch);
  const deferredSkillSearch = useDeferredValue(skillSearch);

  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const codexCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("codex"));
  const claudeCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("claudeAgent"));
  const cursorCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("cursor"));
  const antigravityCapabilitiesQuery = useQuery(
    providerComposerCapabilitiesQueryOptions("antigravity"),
  );
  const grokCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("grok"));
  const droidCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("droid"));
  const kiloCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("kilo"));
  const openCodeCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("opencode"));
  const piCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("pi"));

  const providerCapabilities = useMemo<ProviderCapabilitiesByKind>(
    () => ({
      codex: {
        plugins: supportsPluginDiscovery(codexCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(codexCapabilitiesQuery.data),
      },
      claudeAgent: {
        plugins: supportsPluginDiscovery(claudeCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(claudeCapabilitiesQuery.data),
      },
      cursor: {
        plugins: supportsPluginDiscovery(cursorCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(cursorCapabilitiesQuery.data),
      },
      antigravity: {
        plugins: supportsPluginDiscovery(antigravityCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(antigravityCapabilitiesQuery.data),
      },
      grok: {
        plugins: supportsPluginDiscovery(grokCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(grokCapabilitiesQuery.data),
      },
      droid: {
        plugins: supportsPluginDiscovery(droidCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(droidCapabilitiesQuery.data),
      },
      kilo: {
        plugins: supportsPluginDiscovery(kiloCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(kiloCapabilitiesQuery.data),
      },
      opencode: {
        plugins: supportsPluginDiscovery(openCodeCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(openCodeCapabilitiesQuery.data),
      },
      pi: {
        plugins: supportsPluginDiscovery(piCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(piCapabilitiesQuery.data),
      },
    }),
    [
      antigravityCapabilitiesQuery.data,
      claudeCapabilitiesQuery.data,
      codexCapabilitiesQuery.data,
      cursorCapabilitiesQuery.data,
      droidCapabilitiesQuery.data,
      grokCapabilitiesQuery.data,
      kiloCapabilitiesQuery.data,
      openCodeCapabilitiesQuery.data,
      piCapabilitiesQuery.data,
    ],
  );

  useEffect(() => {
    const supportsTab =
      selectedTab === "plugins"
        ? providerCapabilities[selectedProvider].plugins
        : providerCapabilities[selectedProvider].skills;
    if (supportsTab) return;

    const fallbackOrder =
      selectedTab === "plugins"
        ? PROVIDER_DISCOVERY_ORDER
        : [preferredProvider, ...PROVIDER_DISCOVERY_ORDER.filter((p) => p !== preferredProvider)];
    const fallback =
      fallbackOrder.find((provider) =>
        selectedTab === "plugins"
          ? providerCapabilities[provider].plugins
          : providerCapabilities[provider].skills,
      ) ?? null;
    if (fallback) setSelectedProvider(fallback);
  }, [preferredProvider, providerCapabilities, selectedProvider, selectedTab]);

  const discoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: activeThread?.worktreePath ?? null,
    activeProjectCwd: activeProject?.cwd ?? null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const providerLabel = PROVIDER_DISPLAY_NAMES[selectedProvider];
  const canListPlugins = providerCapabilities[selectedProvider].plugins;
  const canListSkills = providerCapabilities[selectedProvider].skills;

  const pluginsQuery = useQuery(
    providerPluginsQueryOptions({
      provider: selectedProvider,
      cwd: discoveryCwd,
      threadId: focusedThreadId,
      enabled: selectedTab === "plugins" && canListPlugins,
    }),
  );
  const skillsQuery = useQuery(
    providerSkillsQueryOptions({
      provider: selectedProvider,
      cwd: discoveryCwd,
      threadId: focusedThreadId,
      enabled: selectedTab === "skills" && canListSkills && discoveryCwd !== null,
    }),
  );

  const discoveredSkills = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data?.skills],
  );
  const pluginEntries = useMemo<PluginEntry[]>(() => {
    const featuredIds = new Set(pluginsQuery.data?.featuredPluginIds ?? []);
    return (pluginsQuery.data?.marketplaces ?? []).flatMap((marketplace) =>
      marketplace.plugins.map((plugin) => ({
        marketplaceName: marketplace.name,
        marketplacePath: marketplace.path,
        plugin,
        isFeatured: featuredIds.has(plugin.id),
      })),
    );
  }, [pluginsQuery.data]);
  const installedPluginEntries = useMemo(
    () => pluginEntries.filter((entry) => isInstalledProviderPlugin(entry.plugin)),
    [pluginEntries],
  );
  const filteredPluginEntries = useMemo(() => {
    const query = normalizeProviderDiscoveryText(deferredPluginSearch);
    if (!query) return installedPluginEntries;
    return rankProviderDiscoveryItems(installedPluginEntries, query, (entry) =>
      buildPluginSearchFields(entry.plugin),
    );
  }, [deferredPluginSearch, installedPluginEntries]);
  const marketplaceSections = useMemo<MarketplaceSection[]>(() => {
    const sections = new Map<string, { title: string; entries: PluginEntry[] }>();
    for (const entry of filteredPluginEntries) {
      const existing = sections.get(entry.marketplacePath);
      if (existing) {
        existing.entries.push(entry);
      } else {
        sections.set(entry.marketplacePath, {
          title: sectionTitle(entry.marketplaceName),
          entries: [entry],
        });
      }
    }
    return Array.from(sections.entries()).map(([key, section]) => ({ key, ...section }));
  }, [filteredPluginEntries]);
  const filteredSkills = useMemo(() => {
    const query = normalizeProviderDiscoveryText(deferredSkillSearch);
    if (!query) return discoveredSkills;
    return rankProviderDiscoveryItems(discoveredSkills, query, buildSkillSearchFields);
  }, [deferredSkillSearch, discoveredSkills]);

  const selectProvider = useCallback(
    (provider: ProviderKind) => {
      const capabilities = providerCapabilities[provider];
      setSelectedProvider(provider);
      if (selectedTab === "plugins" && !capabilities.plugins && capabilities.skills) {
        setSelectedTab("skills");
      }
      if (selectedTab === "skills" && !capabilities.skills && capabilities.plugins) {
        setSelectedTab("plugins");
      }
    },
    [providerCapabilities, selectedTab],
  );

  return {
    canListPlugins,
    canListSkills,
    discoveredSkills,
    discoveryCwd,
    filteredPluginEntries,
    filteredSkills,
    marketplaceSections,
    pluginEntries,
    pluginSearch,
    pluginsQuery,
    providerCapabilities,
    providerLabel,
    selectedProvider,
    selectedTab,
    selectProvider,
    setPluginSearch,
    setSelectedTab,
    setSkillSearch,
    skillSearch,
    skillsQuery,
  };
}

export type PluginLibraryCatalog = ReturnType<typeof usePluginLibraryCatalog>;
