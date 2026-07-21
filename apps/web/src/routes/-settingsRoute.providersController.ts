import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import type { AppSettings } from "../appSettings";
import { toastManager } from "../components/ui/toast";
import { ensureNativeApi } from "../nativeApi";
import { sameProviderOrder } from "../providerOrdering";
import {
  getVisibleProviderUpdateStatuses,
  shouldShowProviderUpdateStatus,
  withProviderUpdateTimeout,
} from "../providerUpdates";
import { serverQueryKeys } from "../lib/serverReactQuery";
import { providerUpdateFailureMessage } from "./-settingsRoute.providerCatalog";
import { useSettingsTargetScroll } from "./-settingsRoute.targetScroll";

const EMPTY_PROVIDER_STATUSES: ReadonlyArray<ServerProviderStatus> = [];

function initialOpenProviders(settings: AppSettings): Record<ProviderKind, boolean> {
  return {
    codex: Boolean(settings.codexBinaryPath || settings.codexHomePath),
    claudeAgent: Boolean(settings.claudeBinaryPath),
    cursor: Boolean(settings.cursorBinaryPath || settings.cursorApiEndpoint),
    antigravity: Boolean(settings.antigravityBinaryPath),
    grok: Boolean(settings.grokBinaryPath),
    droid: Boolean(settings.droidBinaryPath),
    kilo: Boolean(settings.kiloBinaryPath || settings.kiloServerUrl || settings.kiloServerPassword),
    opencode: Boolean(
      settings.openCodeBinaryPath ||
      settings.openCodeExperimentalWebSockets ||
      settings.openCodeServerUrl ||
      settings.openCodeServerPassword,
    ),
    pi: Boolean(settings.piBinaryPath || settings.piAgentDir),
  };
}

function closedProviders(): Record<ProviderKind, boolean> {
  return {
    codex: false,
    claudeAgent: false,
    cursor: false,
    antigravity: false,
    grok: false,
    droid: false,
    kilo: false,
    opencode: false,
    pi: false,
  };
}

export function useSettingsProvidersController(input: {
  active: boolean;
  scrollToUpdates: boolean;
  settings: AppSettings;
  defaults: AppSettings;
  providers: ReadonlyArray<ServerProviderStatus> | undefined;
  serverSettings: ServerSettings | null | undefined;
}) {
  const queryClient = useQueryClient();
  const providers = input.providers ?? EMPTY_PROVIDER_STATUSES;
  const updatesRef = useRef<HTMLDivElement | null>(null);
  const installsRef = useRef<HTMLDivElement | null>(null);
  const [openInstallProviders, setOpenInstallProviders] = useState<Record<ProviderKind, boolean>>(
    () => initialOpenProviders(input.settings),
  );
  const [updatingProviders, setUpdatingProviders] = useState<ReadonlySet<ProviderKind>>(
    () => new Set(),
  );
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(input.settings.hiddenProviders),
    [input.settings.hiddenProviders],
  );
  const providerStatusByProvider = useMemo(
    () => new Map(providers.map((status) => [status.provider, status])),
    [providers],
  );
  const providerUpdateServerSettings = useMemo(
    () =>
      input.serverSettings
        ? {
            ...input.serverSettings,
            enableProviderUpdateChecks: input.settings.enableProviderUpdateChecks,
          }
        : null,
    [input.serverSettings, input.settings.enableProviderUpdateChecks],
  );
  const outdatedProviderStatuses = useMemo(
    () =>
      getVisibleProviderUpdateStatuses({
        providers,
        hiddenProviders: input.settings.hiddenProviders,
        serverSettings: providerUpdateServerSettings,
      }),
    [providers, input.settings.hiddenProviders, providerUpdateServerSettings],
  );

  useSettingsTargetScroll(input.active && input.scrollToUpdates, updatesRef, input.providers);

  const runProviderUpdate = useCallback(
    async (provider: ProviderKind) => {
      if (updatingProviders.has(provider)) return;
      setUpdatingProviders((current) => new Set(current).add(provider));
      try {
        const result = await withProviderUpdateTimeout({
          provider,
          request: ensureNativeApi().server.updateProvider({ provider }),
        });
        const refreshedProvider = result.providers.find((status) => status.provider === provider);
        const failureMessage = providerUpdateFailureMessage(refreshedProvider);
        if (failureMessage) {
          const manualCommand = refreshedProvider?.versionAdvisory?.updateCommand?.trim();
          toastManager.add({
            type: "error",
            title: `Could not update ${PROVIDER_DISPLAY_NAMES[provider]}`,
            description: manualCommand
              ? `${failureMessage}\n\nCopy the command below to update manually in a terminal.`
              : failureMessage,
            ...(manualCommand ? { data: { copyText: manualCommand } } : {}),
          });
          return;
        }
        toastManager.add({
          type: "success",
          title: `${PROVIDER_DISPLAY_NAMES[provider]} update finished`,
          description: "New sessions will use the refreshed provider.",
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Could not update ${PROVIDER_DISPLAY_NAMES[provider]}`,
          description: error instanceof Error ? error.message : "The provider update failed.",
        });
      } finally {
        await queryClient
          .invalidateQueries({ queryKey: serverQueryKeys.config() })
          .catch(() => undefined);
        setUpdatingProviders((current) => {
          const next = new Set(current);
          next.delete(provider);
          return next;
        });
      }
    },
    [queryClient, updatingProviders],
  );

  const isProviderUpdateVisible = useCallback(
    (provider: ServerProviderStatus) =>
      shouldShowProviderUpdateStatus({
        provider,
        hiddenProviderSet,
        serverSettings: providerUpdateServerSettings,
      }),
    [hiddenProviderSet, providerUpdateServerSettings],
  );

  return {
    updatesRef,
    installsRef,
    openInstallProviders,
    setOpenInstallProviders,
    updatingProviders,
    hiddenProviderCount: hiddenProviderSet.size,
    isProviderOrderDirty: !sameProviderOrder(
      input.settings.providerOrder,
      input.defaults.providerOrder,
    ),
    providerStatusByProvider,
    outdatedProviderStatuses,
    outdatedProviderCount: outdatedProviderStatuses.length,
    isProviderUpdateVisible,
    runProviderUpdate,
    resetUi: () => setOpenInstallProviders(closedProviders()),
  };
}
