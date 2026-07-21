// FILE: _chat.settings.tsx
// Purpose: Render the dedicated settings experience with its own section sidebar and grouped panels.
// Layer: Route screen
// Exports: Settings route component for `/settings`

import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { TERMINAL_FONT_FAMILY_SUGGESTIONS, useAppSettings } from "../appSettings";
import { useDesktopTopBarTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions, serverSettingsQueryOptions } from "../lib/serverReactQuery";
import { isMacPlatform } from "../lib/utils";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import {
  normalizeSettingsSection,
  SETTINGS_NAV_ITEMS,
  SETTINGS_TARGETS,
} from "../settingsNavigation";
import { useStore } from "../store";
import { createThreadShellsSelector } from "../storeSelectors";
import { SettingsActivePanel } from "./-settingsRoute.activePanel";
import { useAdvancedSettingsController } from "./-settingsRoute.advancedController";
import { useArchivedThreadsSettingsController } from "./-settingsRoute.archivedController";
import { useSettingsAppSnapController } from "./-settingsRoute.appSnapController";
import { useCustomModelsSettingsController } from "./-settingsRoute.customModelsController";
import { useSettingsNotificationsController } from "./-settingsRoute.notificationsController";
import { useSettingsProvidersController } from "./-settingsRoute.providersController";
import { changedSettingsLabels } from "./-settingsRoute.restoreModel";
import { SettingsRouteShell } from "./-settingsRoute.shell";
import { useSettingsTargetScroll } from "./-settingsRoute.targetScroll";
import { useManagedWorktreesController } from "./-settingsRoute.worktreesController";

// ── Settings taxonomy ──────────────────────────────────────────────────────

function SettingsRouteView() {
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;
  const activeSectionItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection)!;

  const {
    isDefaultActiveTheme,
    resetAllThemes,
    resolvedTheme,
    theme,
    setTheme,
    systemUiFont,
    setSystemUiFont,
  } = useTheme();
  const { settings, defaults, updateSettings, resetSettings } = useAppSettings();
  const notificationsController = useSettingsNotificationsController({ updateSettings });
  const appSnapController = useSettingsAppSnapController({
    active: activeSection === "appsnap",
    enabled: settings.enableAppSnap,
    updateSettings,
  });
  const customModelsController = useCustomModelsSettingsController({
    settings,
    updateSettings,
  });
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  // Shell-level subscription on purpose: the full-thread selector invalidates on every
  // streaming message/activity tick, which would re-render this whole route while a
  // turn is running. Settings only needs thread metadata (and message emptiness below).
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const projects = useStore((store) => store.projects);
  const environmentPanelRef = useRef<HTMLDivElement | null>(null);
  const worktreesController = useManagedWorktreesController({
    active: activeSection === "worktrees",
    threadShells,
  });
  const archivedController = useArchivedThreadsSettingsController({ threadShells });
  const advancedController = useAdvancedSettingsController({
    keybindingsConfigPath: serverConfigQuery.data?.keybindingsConfigPath ?? null,
    availableEditors: serverConfigQuery.data?.availableEditors,
    threadShells,
  });
  const providersController = useSettingsProvidersController({
    active: activeSection === "providers",
    scrollToUpdates: settingsTarget === SETTINGS_TARGETS.providerUpdates,
    settings,
    defaults,
    providers: serverConfigQuery.data?.providers,
    serverSettings: serverSettingsQuery.data,
  });
  const shouldShowFontSmoothing = isMacPlatform(
    typeof navigator === "undefined" ? "" : navigator.platform,
  );
  const visibleTerminalFontFamilySuggestions = useMemo(() => {
    const query = settings.terminalFontFamily.trim().toLowerCase();
    if (!query) return TERMINAL_FONT_FAMILY_SUGGESTIONS;
    return TERMINAL_FONT_FAMILY_SUGGESTIONS.filter((suggestion) =>
      suggestion.toLowerCase().includes(query),
    );
  }, [settings.terminalFontFamily]);

  // Deep-link target for the chat Environment panel's gear button (see EnvironmentPanel).
  useSettingsTargetScroll(
    activeSection === "general" && settingsTarget === SETTINGS_TARGETS.environmentPanel,
    environmentPanelRef,
  );

  // Sidebar search deep-links to an individual row via its `settingRowAnchorId`. The active
  // panel renders synchronously with this section change, so scroll once the row has mounted.
  useEffect(() => {
    if (!settingsTarget || !settingsTarget.startsWith("setting-")) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(settingsTarget)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, settingsTarget]);
  const changedSettingLabels = changedSettingsLabels({
    settings,
    defaults,
    theme,
    resolvedTheme,
    isDefaultActiveTheme,
    shouldShowFontSmoothing,
  });

  async function restoreDefaults() {
    if (changedSettingLabels.length === 0) return;

    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetAllThemes();
    resetSettings();
    providersController.resetUi();
    customModelsController.reset();
    advancedController.resetUi();
  }

  const activePanel = (
    <SettingsActivePanel
      activeSection={activeSection}
      settings={settings}
      defaults={defaults}
      updateSettings={updateSettings}
      theme={{
        resolvedTheme,
        theme,
        setTheme,
        systemUiFont,
        setSystemUiFont,
      }}
      environmentPanelRef={environmentPanelRef}
      shouldShowFontSmoothing={shouldShowFontSmoothing}
      visibleTerminalFontFamilySuggestions={visibleTerminalFontFamilySuggestions}
      notifications={notificationsController}
      appSnap={appSnapController}
      worktrees={worktreesController}
      archived={archivedController}
      customModels={customModelsController}
      providers={providersController}
      advanced={advancedController}
      projects={projects}
      keybindingsConfigPath={serverConfigQuery.data?.keybindingsConfigPath ?? null}
    />
  );

  return (
    <SettingsRouteShell
      activeSection={activeSection}
      activeSectionLabel={activeSectionItem.label}
      activeSectionDescription={activeSectionItem.description}
      activePanel={activePanel}
      changedCount={changedSettingLabels.length}
      restoreDefaults={restoreDefaults}
      trafficLightGutterClassName={desktopTopBarTrafficLightGutterClassName ?? ""}
      releaseHistoryOpen={advancedController.releaseHistoryOpen}
      setReleaseHistoryOpen={advancedController.setReleaseHistoryOpen}
      openSourceLicensesOpen={advancedController.openSourceLicensesOpen}
      setOpenSourceLicensesOpen={advancedController.setOpenSourceLicensesOpen}
    />
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
