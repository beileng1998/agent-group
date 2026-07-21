// FILE: useComposerMenuModel.ts
// Purpose: Own composer discovery queries and the trigger-driven command menu model.
// Layer: Web composer controller

import {
  type ProviderKind,
  type ProviderMentionReference,
  type ProviderStartOptions,
  type ThreadId,
} from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useMemo } from "react";

import type { ComposerTrigger } from "../composer-logic";
import { hasProviderNativeSlashCommand } from "../composerSlashCommands";
import { useComposerCommandMenuItems } from "./useComposerCommandMenuItems";
import {
  providerComposerCapabilitiesQueryOptions,
  providerCommandsQueryOptions,
  providerPluginsQueryOptions,
  providerSkillsQueryOptions,
  supportsNativeSlashCommandDiscovery,
  supportsPluginDiscovery,
  supportsSkillDiscovery,
  supportsThreadCompaction,
} from "../lib/providerDiscoveryReactQuery";
import { projectSearchEntriesQueryOptions } from "../lib/projectReactQuery";
import {
  getLocalFolderBrowseRootPath,
  isLocalFolderMentionQuery,
} from "../lib/localFolderMentions";
import { isMacPlatform } from "../lib/utils";
import { AGENT_GROUP_APP_SLASH_COMMANDS } from "../agentGroupCapabilities";
import type { AgentGroupSessionMentionCandidate } from "../agentGroupSessionMentions";
import {
  COMPOSER_PATH_QUERY_DEBOUNCE_MS,
  EMPTY_COMPOSER_PLUGIN_SUGGESTIONS,
} from "../components/chat/chatViewComposerValues";
import {
  EMPTY_PROJECT_ENTRIES,
  EMPTY_PROVIDER_NATIVE_COMMANDS,
  EMPTY_PROVIDER_SKILLS,
} from "../components/chat/chatViewProviderValues";

type ComposerMenuInput = Parameters<typeof useComposerCommandMenuItems>[0];

interface UseComposerMenuModelOptions {
  canOfferExportCommand: boolean;
  canOfferForkCommand: boolean;
  canOfferSideCommand: boolean;
  commandPicker: null | "fork-target" | "review-target";
  compactionEligible: boolean;
  composerTrigger: ComposerTrigger | null;
  dynamicAgents: ComposerMenuInput["dynamicAgents"];
  homeDir: string | null;
  piAgentDir: string | null;
  provider: ProviderKind;
  providerDiscoveryCwd: string | null;
  providerOptions: ProviderStartOptions | undefined;
  searchableModelOptions: ComposerMenuInput["searchableModelOptions"];
  sessionMentions: readonly AgentGroupSessionMentionCandidate[];
  supportsFastSlashCommand: boolean;
  threadId: ThreadId;
  workspaceCwd: string | null;
}

export function useComposerMenuModel(options: UseComposerMenuModelOptions) {
  const {
    canOfferExportCommand,
    canOfferForkCommand,
    canOfferSideCommand,
    commandPicker,
    compactionEligible,
    composerTrigger,
    dynamicAgents,
    homeDir,
    piAgentDir,
    provider,
    providerDiscoveryCwd,
    providerOptions,
    searchableModelOptions,
    sessionMentions,
    supportsFastSlashCommand,
    threadId,
    workspaceCwd,
  } = options;
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const mentionTriggerQuery = composerTrigger?.kind === "mention" ? composerTrigger.query : "";
  const isMentionTrigger = composerTriggerKind === "mention";
  const localFolderBrowseRootPath = getLocalFolderBrowseRootPath(
    homeDir,
    isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform),
  );
  const isLocalFolderBrowserOpen =
    commandPicker === null && isMentionTrigger && isLocalFolderMentionQuery(mentionTriggerQuery);
  const isSkillTrigger = composerTriggerKind === "skill";
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    mentionTriggerQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectiveMentionQuery = mentionTriggerQuery.length > 0 ? debouncedPathQuery : "";
  const providerComposerCapabilitiesQuery = useQuery(
    providerComposerCapabilitiesQueryOptions(provider),
  );
  const providerCommandsQuery = useQuery(
    providerCommandsQueryOptions({
      provider,
      cwd: providerDiscoveryCwd,
      threadId,
      binaryPath:
        (provider === "opencode"
          ? providerOptions?.opencode?.binaryPath
          : provider === "kilo"
            ? providerOptions?.kilo?.binaryPath
            : null) ?? null,
      serverUrl:
        (provider === "opencode"
          ? providerOptions?.opencode?.serverUrl
          : provider === "kilo"
            ? providerOptions?.kilo?.serverUrl
            : null) ?? null,
      serverPassword:
        (provider === "opencode"
          ? providerOptions?.opencode?.serverPassword
          : provider === "kilo"
            ? providerOptions?.kilo?.serverPassword
            : null) ?? null,
      experimentalWebSockets:
        provider === "opencode" ? providerOptions?.opencode?.experimentalWebSockets : undefined,
      agentDir: provider === "pi" ? piAgentDir : null,
      enabled:
        (composerTriggerKind === "slash-command" || composerTriggerKind === "slash-model") &&
        supportsNativeSlashCommandDiscovery(providerComposerCapabilitiesQuery.data) &&
        providerDiscoveryCwd !== null,
    }),
  );
  const canDiscoverProviderSkills =
    provider === "pi" || supportsSkillDiscovery(providerComposerCapabilitiesQuery.data);
  const providerSkillsQuery = useQuery(
    providerSkillsQueryOptions({
      provider,
      cwd: providerDiscoveryCwd,
      threadId,
      agentDir: provider === "pi" ? piAgentDir : null,
      enabled:
        (isSkillTrigger || composerTriggerKind === "slash-command" || provider === "pi") &&
        canDiscoverProviderSkills &&
        providerDiscoveryCwd !== null,
    }),
  );
  const providerPluginsQuery = useQuery(
    providerPluginsQueryOptions({
      provider,
      cwd: providerDiscoveryCwd,
      threadId,
      enabled:
        supportsPluginDiscovery(providerComposerCapabilitiesQuery.data) &&
        providerDiscoveryCwd !== null,
    }),
  );
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceCwd,
      query: effectiveMentionQuery,
      enabled: isMentionTrigger && !isLocalFolderBrowserOpen,
      limit: 80,
    }),
  );
  const providerPlugins = useMemo(
    () =>
      providerPluginsQuery.data?.marketplaces.flatMap((marketplace) =>
        marketplace.plugins.map((plugin) => ({
          plugin,
          mention: {
            name: plugin.name,
            path: `plugin://${plugin.name}@${marketplace.name}`,
          } satisfies ProviderMentionReference,
        })),
      ) ?? EMPTY_COMPOSER_PLUGIN_SUGGESTIONS,
    [providerPluginsQuery.data],
  );
  const providerNativeCommands = useMemo(
    () =>
      (providerCommandsQuery.data?.commands ?? EMPTY_PROVIDER_NATIVE_COMMANDS).filter(
        (command) => command.name.toLowerCase() !== "review",
      ),
    [providerCommandsQuery.data?.commands],
  );
  const providerNativeCommandNames = useMemo(
    () => providerNativeCommands.map((command) => command.name),
    [providerNativeCommands],
  );
  const effectiveComposerTrigger = useMemo(() => {
    if (
      composerTrigger?.kind === "slash-model" &&
      hasProviderNativeSlashCommand(provider, providerNativeCommandNames, "model")
    ) {
      return { ...composerTrigger, kind: "slash-command" as const, query: "model" };
    }
    return composerTrigger;
  }, [composerTrigger, provider, providerNativeCommandNames]);
  const canOfferCompactCommand =
    supportsThreadCompaction(providerComposerCapabilitiesQuery.data) && compactionEligible;
  const normalComposerMenuItems = useComposerCommandMenuItems({
    composerTrigger: effectiveComposerTrigger,
    provider,
    providerPlugins,
    providerNativeCommands,
    providerSkills: providerSkillsQuery.data?.skills ?? EMPTY_PROVIDER_SKILLS,
    workspaceEntries: workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES,
    searchableModelOptions,
    supportsFastSlashCommand,
    canOfferCompactCommand,
    canOfferReviewCommand: false,
    canOfferForkCommand,
    canOfferSideCommand,
    canOfferExportCommand,
    surfaceAppSlashCommands: AGENT_GROUP_APP_SLASH_COMMANDS,
    dynamicAgents,
    sessionMentions,
  });
  const isComposerMenuLoading =
    (composerTriggerKind === "mention" &&
      ((mentionTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
        workspaceEntriesQuery.isLoading ||
        workspaceEntriesQuery.isFetching ||
        providerPluginsQuery.isLoading ||
        providerPluginsQuery.isFetching)) ||
    (composerTriggerKind === "slash-command" &&
      (providerCommandsQuery.isLoading ||
        providerCommandsQuery.isFetching ||
        providerSkillsQuery.isLoading ||
        providerSkillsQuery.isFetching)) ||
    (composerTriggerKind === "skill" &&
      (providerComposerCapabilitiesQuery.isLoading ||
        providerComposerCapabilitiesQuery.isFetching ||
        providerSkillsQuery.isLoading ||
        providerSkillsQuery.isFetching));

  return {
    canOfferCompactCommand,
    effectiveComposerTriggerKind: effectiveComposerTrigger?.kind ?? null,
    isComposerMenuLoading,
    isLocalFolderBrowserOpen,
    localFolderBrowseRootPath,
    mentionTriggerQuery,
    normalComposerMenuItems,
    providerNativeCommands,
    supportsTextNativeReviewCommand: providerNativeCommands.some(
      (command) => command.name.toLowerCase() === "review",
    ),
  };
}
