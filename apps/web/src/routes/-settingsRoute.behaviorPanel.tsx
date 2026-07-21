import type { AppSettings } from "../appSettings";
import { SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { SettingsBooleanRow } from "./-settingsRoute.booleanRow";

export interface BehaviorSettingsPanelProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

export function BehaviorSettingsPanel(props: BehaviorSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsSection title="Runtime behavior">
        <SettingsBooleanRow
          settings={props.settings}
          defaults={props.defaults}
          updateSettings={props.updateSettings}
          settingKey="enableAssistantStreaming"
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetLabel="assistant output"
          ariaLabel="Stream assistant messages"
        />

        <SettingsBooleanRow
          settings={props.settings}
          defaults={props.defaults}
          updateSettings={props.updateSettings}
          settingKey="diffWordWrap"
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session."
          resetLabel="diff line wrapping"
          ariaLabel="Wrap diff lines by default"
        />
      </SettingsSection>

      <SettingsSection title="Terminal safety">
        <SettingsBooleanRow
          settings={props.settings}
          defaults={props.defaults}
          updateSettings={props.updateSettings}
          settingKey="confirmTerminalTabClose"
          title="Terminal close confirmation"
          description="Ask before closing a terminal tab and clearing its history."
          resetLabel="terminal close confirmation"
          ariaLabel="Confirm terminal tab close"
        />
      </SettingsSection>
    </div>
  );
}
