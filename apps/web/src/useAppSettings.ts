import { DEFAULT_SERVER_SETTINGS } from "@agent-group/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useLocalStorage } from "./hooks/useLocalStorage";
import { providerDiscoveryQueryKeys } from "./lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "./lib/serverReactQuery";
import { ensureNativeApi } from "./nativeApi";
import {
  normalizeAppSettings,
  normalizeStoredAppSettings,
  serverSettingsToAppSettings,
} from "./appSettingsNormalization";
import {
  APP_SETTINGS_STORAGE_KEY,
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  SERVER_SETTINGS_MIGRATION_STORAGE_KEY,
  type AppSettings,
} from "./appSettingsSchema";
import {
  appSettingsPatchToServerSettingsPatch,
  buildInitialServerSettingsMigrationPatch,
  isServerSettingsPatchEmpty,
  touchesProviderDiscoverySettings,
} from "./appSettingsServerSync";

let serverSettingsMigrationInFlight = false;

export function useAppSettings() {
  const queryClient = useQueryClient();
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [localSettings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );
  const normalizedStoredSettingsRef = useRef(false);

  const defaults = useMemo(
    () =>
      normalizeAppSettings({
        ...DEFAULT_APP_SETTINGS,
        ...serverSettingsToAppSettings(DEFAULT_SERVER_SETTINGS),
      }),
    [],
  );

  const settings = useMemo(
    () =>
      normalizeAppSettings({
        ...localSettings,
        ...(serverSettingsQuery.data ? serverSettingsToAppSettings(serverSettingsQuery.data) : {}),
      }),
    [localSettings, serverSettingsQuery.data],
  );

  useEffect(() => {
    if (normalizedStoredSettingsRef.current) return;
    normalizedStoredSettingsRef.current = true;
    setSettings((previous) => normalizeStoredAppSettings(previous));
  }, [setSettings]);

  useEffect(() => {
    if (!serverSettingsQuery.data || serverSettingsMigrationInFlight) return;
    if (globalThis.localStorage?.getItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY) === "1") return;

    const migrationPatch = buildInitialServerSettingsMigrationPatch(localSettings);
    if (isServerSettingsPatchEmpty(migrationPatch)) {
      globalThis.localStorage?.setItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY, "1");
      return;
    }

    serverSettingsMigrationInFlight = true;
    void ensureNativeApi()
      .server.updateSettings(migrationPatch)
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        globalThis.localStorage?.setItem(SERVER_SETTINGS_MIGRATION_STORAGE_KEY, "1");
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      })
      .finally(() => {
        serverSettingsMigrationInFlight = false;
      });
  }, [localSettings, queryClient, serverSettingsQuery.data]);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((previous) => normalizeAppSettings({ ...previous, ...patch }));
      if (touchesProviderDiscoverySettings(patch)) {
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      }

      const serverPatch = appSettingsPatchToServerSettingsPatch(patch);
      if (isServerSettingsPatchEmpty(serverPatch)) return;
      void ensureNativeApi()
        .server.updateSettings(serverPatch)
        .then((nextSettings) => {
          queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
        });
    },
    [queryClient, setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
    void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
    const serverPatch = appSettingsPatchToServerSettingsPatch(defaults);
    void ensureNativeApi()
      .server.updateSettings(serverPatch)
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  }, [defaults, queryClient, setSettings]);

  return { settings, updateSettings, resetSettings, defaults } as const;
}
