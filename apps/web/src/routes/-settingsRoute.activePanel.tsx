import type { AppSettings } from "../appSettings";
import { AgentGroupSettingsPanel } from "../components/settings/AgentGroupSettingsPanel";
import { KeyboardShortcutsSettingsPanel } from "../components/settings/KeyboardShortcutsSettingsPanel";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { ProviderUsageSettingsPanel } from "../components/settings/ProviderUsageSettingsPanel";
import { RemoteAccessSettingsPanel } from "../components/settings/RemoteAccessSettingsPanel";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { playAppSnapCaptureSound } from "../lib/appSnapSound";
import type { useTheme } from "../hooks/useTheme";
import type { SettingsSectionId } from "../settingsNavigation";
import type { Project } from "../types";
import { AdvancedSettingsPanel } from "./-settingsRoute.advancedPanel";
import type { useAdvancedSettingsController } from "./-settingsRoute.advancedController";
import { AppSnapSettingsPanel } from "./-settingsRoute.appSnapPanel";
import type { useSettingsAppSnapController } from "./-settingsRoute.appSnapController";
import { SettingsAppearancePanel } from "./-settingsRoute.appearancePanel";
import { SettingsArchivedPanel } from "./-settingsRoute.archivedPanel";
import type { useArchivedThreadsSettingsController } from "./-settingsRoute.archivedController";
import { BehaviorSettingsPanel } from "./-settingsRoute.behaviorPanel";
import type { useCustomModelsSettingsController } from "./-settingsRoute.customModelsController";
import { SettingsGeneralPanel } from "./-settingsRoute.generalPanel";
import { ModelsSettingsPanel } from "./-settingsRoute.modelsPanel";
import { NotificationsSettingsPanel } from "./-settingsRoute.notificationsPanel";
import type { useSettingsNotificationsController } from "./-settingsRoute.notificationsController";
import { ProviderPickerSettingsPanel } from "./-settingsRoute.providerPickerPanel";
import { ProviderToolsPanel } from "./-settingsRoute.providerToolsPanel";
import { ProviderUpdatesSettingsPanel } from "./-settingsRoute.providerUpdatesPanel";
import type { useSettingsProvidersController } from "./-settingsRoute.providersController";
import { SettingsWorktreesPanel } from "./-settingsRoute.worktreesPanel";
import type { useManagedWorktreesController } from "./-settingsRoute.worktreesController";
import type { RefObject } from "react";

type UpdateSettings = (patch: Partial<AppSettings>) => void;

export interface SettingsActivePanelProps {
  activeSection: SettingsSectionId;
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: UpdateSettings;
  theme: Pick<
    ReturnType<typeof useTheme>,
    "theme" | "resolvedTheme" | "setTheme" | "systemUiFont" | "setSystemUiFont"
  >;
  environmentPanelRef: RefObject<HTMLDivElement | null>;
  shouldShowFontSmoothing: boolean;
  visibleTerminalFontFamilySuggestions: ReadonlyArray<string>;
  notifications: ReturnType<typeof useSettingsNotificationsController>;
  appSnap: ReturnType<typeof useSettingsAppSnapController>;
  worktrees: ReturnType<typeof useManagedWorktreesController>;
  archived: ReturnType<typeof useArchivedThreadsSettingsController>;
  customModels: ReturnType<typeof useCustomModelsSettingsController>;
  providers: ReturnType<typeof useSettingsProvidersController>;
  advanced: ReturnType<typeof useAdvancedSettingsController>;
  projects: ReadonlyArray<Project>;
  keybindingsConfigPath: string | null;
}

export function SettingsActivePanel(props: SettingsActivePanelProps) {
  const { settings, defaults, updateSettings } = props;
  switch (props.activeSection) {
    case "general":
      return (
        <SettingsGeneralPanel
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
          environmentPanelRef={props.environmentPanelRef}
        />
      );
    case "appearance":
      return (
        <SettingsAppearancePanel
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
          theme={props.theme.theme}
          resolvedTheme={props.theme.resolvedTheme}
          setTheme={props.theme.setTheme}
          systemUiFont={props.theme.systemUiFont}
          setSystemUiFont={props.theme.setSystemUiFont}
          shouldShowFontSmoothing={props.shouldShowFontSmoothing}
          visibleTerminalFontFamilySuggestions={props.visibleTerminalFontFamilySuggestions}
        />
      );
    case "notifications":
      return (
        <NotificationsSettingsPanel
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
          browserNotificationPermission={props.notifications.permission}
          setSystemNotificationsEnabled={props.notifications.setEnabled}
          sendTestNotification={props.notifications.sendTest}
        />
      );
    case "access":
      return <RemoteAccessSettingsPanel />;
    case "behavior":
      return (
        <BehaviorSettingsPanel
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
        />
      );
    case "appsnap":
      return (
        <AppSnapSettingsPanel
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
          appSnapState={props.appSnap.state}
          setAppSnapEnabled={props.appSnap.setEnabled}
          recheckAppSnapPermissions={props.appSnap.recheckPermissions}
          previewCaptureSound={playAppSnapCaptureSound}
        />
      );
    case "shortcuts":
      return <KeyboardShortcutsSettingsPanel />;
    case "worktrees":
      return (
        <SettingsWorktreesPanel
          isLoading={props.worktrees.isLoading}
          isError={props.worktrees.isError}
          error={props.worktrees.error}
          worktreesByWorkspaceRoot={props.worktrees.groups}
          deletePending={props.worktrees.deletePending}
          deleteManagedWorktree={props.worktrees.deleteManagedWorktree}
        />
      );
    case "archived":
      return (
        <SettingsArchivedPanel
          projects={props.projects}
          archivedThreads={props.archived.archivedThreads}
          unarchiveThread={props.archived.unarchiveThread}
          deleteArchivedThread={props.archived.deleteArchivedThread}
          handleArchivedThreadContextMenu={props.archived.openContextMenu}
        />
      );
    case "agent-group":
      return <AgentGroupSettingsPanel />;
    case "models": {
      const customModels = props.customModels;
      return (
        <ModelsSettingsPanel
          selectedProvider={customModels.selectedProvider}
          selectedProviderTitle={customModels.selectedProviderSettings.title}
          selectedProviderExample={customModels.selectedProviderSettings.example}
          selectedInput={customModels.selectedInput}
          selectedError={customModels.selectedError}
          savedRows={customModels.savedRows}
          visibleRows={customModels.visibleRows}
          showAll={customModels.showAll}
          onSelectProvider={customModels.setSelectedProvider}
          onInputChange={customModels.setSelectedInput}
          onAdd={() => customModels.add(customModels.selectedProvider)}
          onRemove={customModels.remove}
          onToggleShowAll={() => customModels.setShowAll((value) => !value)}
          onReset={() => {
            updateSettings({
              customCodexModels: defaults.customCodexModels,
              customClaudeModels: defaults.customClaudeModels,
              customCursorModels: defaults.customCursorModels,
              customAntigravityModels: defaults.customAntigravityModels,
              customGrokModels: defaults.customGrokModels,
              customKiloModels: defaults.customKiloModels,
              customOpenCodeModels: defaults.customOpenCodeModels,
              customPiModels: defaults.customPiModels,
            });
            customModels.resetSavedRowsUi();
          }}
        />
      );
    }
    case "providers":
      return (
        <div className="space-y-6">
          <ProviderUpdatesSettingsPanel
            targetRef={props.providers.updatesRef}
            settings={settings}
            defaults={defaults}
            updateSettings={updateSettings}
            outdatedProviderStatuses={props.providers.outdatedProviderStatuses}
            updatingProviders={props.providers.updatingProviders}
            runProviderUpdate={props.providers.runProviderUpdate}
          />
          <ProviderPickerSettingsPanel
            providerOrder={settings.providerOrder}
            hiddenProviders={settings.hiddenProviders}
            isProviderOrderDirty={props.providers.isProviderOrderDirty}
            onProviderOrderChange={(providerOrder) => updateSettings({ providerOrder })}
            onHiddenProvidersChange={(hiddenProviders) => updateSettings({ hiddenProviders })}
            onReset={() =>
              updateSettings({
                hiddenProviders: defaults.hiddenProviders,
                providerOrder: defaults.providerOrder,
              })
            }
          />
          <ProviderToolsPanel
            providerInstallsRef={props.providers.installsRef}
            settings={settings}
            defaults={defaults}
            updateSettings={updateSettings}
            outdatedProviderCount={props.providers.outdatedProviderCount}
            providerStatusByProvider={props.providers.providerStatusByProvider}
            isProviderUpdateVisible={props.providers.isProviderUpdateVisible}
            updatingProviders={props.providers.updatingProviders}
            runProviderUpdate={props.providers.runProviderUpdate}
            openInstallProviders={props.providers.openInstallProviders}
            setOpenInstallProviders={props.providers.setOpenInstallProviders}
          />
        </div>
      );
    case "profile":
      return <ProfileSettingsPanel />;
    case "skills":
      return <SkillsSettingsPanel />;
    case "usage":
      return <ProviderUsageSettingsPanel />;
    case "advanced":
      return (
        <AdvancedSettingsPanel
          keybindingsConfigPath={props.keybindingsConfigPath}
          openKeybindingsError={props.advanced.openKeybindingsError}
          isOpeningKeybindings={props.advanced.isOpeningKeybindings}
          openKeybindingsFile={props.advanced.openKeybindingsFile}
          shouldOfferRecoveryTools={props.advanced.shouldOfferRecoveryTools}
          isRepairingLocalState={props.advanced.isRepairingLocalState}
          repairLocalState={props.advanced.repairLocalState}
          showRecoveryTools={props.advanced.showRecoveryTools}
          toggleRecoveryTools={props.advanced.toggleRecoveryTools}
          openReleaseHistory={props.advanced.openReleaseHistory}
          openSourceLicenses={props.advanced.openSourceLicenses}
        />
      );
    default:
      return null;
  }
}
