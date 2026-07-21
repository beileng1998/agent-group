import type { ProviderKind, ServerProviderStatus } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { AppSettings } from "../appSettings";
import { SettingResetButton } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { SETTINGS_TARGETS } from "../settingsNavigation";
import { SETTINGS_INSET_LIST_CLASS_NAME } from "../settingsPanelStyles";
import { INSTALL_PROVIDER_SETTINGS } from "./-settingsRoute.providerCatalog";
import { isProviderInstallDirty, ProviderInstallRow } from "./-settingsRoute.providerInstallRow";

export type ProviderInstallOpenState = Record<ProviderKind, boolean>;

export interface ProviderToolsPanelProps {
  providerInstallsRef: RefObject<HTMLDivElement | null>;
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  outdatedProviderCount: number;
  providerStatusByProvider: ReadonlyMap<ProviderKind, ServerProviderStatus>;
  isProviderUpdateVisible: (providerStatus: ServerProviderStatus) => boolean;
  updatingProviders: ReadonlySet<ProviderKind>;
  runProviderUpdate: (provider: ProviderKind) => Promise<void> | void;
  openInstallProviders: ProviderInstallOpenState;
  setOpenInstallProviders: Dispatch<SetStateAction<ProviderInstallOpenState>>;
}

function closedProviderInstallRows(): ProviderInstallOpenState {
  return Object.fromEntries(
    INSTALL_PROVIDER_SETTINGS.map(({ provider }) => [provider, false]),
  ) as ProviderInstallOpenState;
}

function resetProviderInstallSettings(
  defaults: AppSettings,
  updateSettings: (patch: Partial<AppSettings>) => void,
): void {
  updateSettings({
    claudeBinaryPath: defaults.claudeBinaryPath,
    claudeMaxTurns: defaults.claudeMaxTurns,
    claudeResponseIdleTimeoutMs: defaults.claudeResponseIdleTimeoutMs,
    codexBinaryPath: defaults.codexBinaryPath,
    codexHomePath: defaults.codexHomePath,
    cursorBinaryPath: defaults.cursorBinaryPath,
    cursorApiEndpoint: defaults.cursorApiEndpoint,
    antigravityBinaryPath: defaults.antigravityBinaryPath,
    grokBinaryPath: defaults.grokBinaryPath,
    droidBinaryPath: defaults.droidBinaryPath,
    kiloBinaryPath: defaults.kiloBinaryPath,
    kiloServerUrl: defaults.kiloServerUrl,
    kiloServerPassword: defaults.kiloServerPassword,
    openCodeBinaryPath: defaults.openCodeBinaryPath,
    openCodeExperimentalWebSockets: defaults.openCodeExperimentalWebSockets,
    openCodeServerUrl: defaults.openCodeServerUrl,
    openCodeServerPassword: defaults.openCodeServerPassword,
    piAgentDir: defaults.piAgentDir,
    piBinaryPath: defaults.piBinaryPath,
  });
}

export function ProviderToolsPanel(props: ProviderToolsPanelProps) {
  const isInstallSettingsDirty = INSTALL_PROVIDER_SETTINGS.some((providerSettings) =>
    isProviderInstallDirty(providerSettings, props.settings, props.defaults),
  );

  const setProviderOpen = (provider: ProviderKind, open: boolean) => {
    props.setOpenInstallProviders((existing) => ({
      ...existing,
      [provider]: open,
    }));
  };

  return (
    <div ref={props.providerInstallsRef} id={SETTINGS_TARGETS.providerInstalls}>
      <SettingsSection title="Provider tools">
        <SettingsRow
          title="Installed CLIs"
          description="Review provider versions and update tools. Open a row only when you need binary overrides."
          status={
            !props.settings.enableProviderUpdateChecks
              ? "Automatic checks off"
              : props.outdatedProviderCount > 0
                ? `${props.outdatedProviderCount} ${pluralize(props.outdatedProviderCount, "update")} available`
                : "No provider updates detected"
          }
          resetAction={
            isInstallSettingsDirty ? (
              <SettingResetButton
                label="provider tools"
                onClick={() => {
                  resetProviderInstallSettings(props.defaults, props.updateSettings);
                  props.setOpenInstallProviders(closedProviderInstallRows());
                }}
              />
            ) : null
          }
        >
          <div className="mt-4">
            <div className={SETTINGS_INSET_LIST_CLASS_NAME}>
              {INSTALL_PROVIDER_SETTINGS.map((providerSettings) => {
                const providerStatus = props.providerStatusByProvider.get(
                  providerSettings.provider,
                );
                return (
                  <ProviderInstallRow
                    key={providerSettings.provider}
                    providerSettings={providerSettings}
                    settings={props.settings}
                    defaults={props.defaults}
                    {...(providerStatus ? { providerStatus } : {})}
                    showProviderUpdateStatus={
                      providerStatus ? props.isProviderUpdateVisible(providerStatus) : false
                    }
                    isOpen={props.openInstallProviders[providerSettings.provider]}
                    updateRequested={props.updatingProviders.has(providerSettings.provider)}
                    updateSettings={props.updateSettings}
                    onOpenChange={(open) => setProviderOpen(providerSettings.provider, open)}
                    onRunProviderUpdate={() => props.runProviderUpdate(providerSettings.provider)}
                  />
                );
              })}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
