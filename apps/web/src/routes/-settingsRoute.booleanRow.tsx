import type { AppSettings } from "../appSettings";
import { SettingResetButton } from "../components/settings/SettingControls";
import { SettingsRow } from "../components/settings/SettingsPanelPrimitives";
import { Switch } from "../components/ui/switch";

export type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

export interface SettingsBooleanRowProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  settingKey: BooleanSettingKey;
  title: string;
  description: string;
  resetLabel: string;
  ariaLabel: string;
}

export function SettingsBooleanRow(props: SettingsBooleanRowProps) {
  const isChanged = props.settings[props.settingKey] !== props.defaults[props.settingKey];
  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      resetAction={
        isChanged ? (
          <SettingResetButton
            label={props.resetLabel}
            onClick={() =>
              props.updateSettings({
                [props.settingKey]: props.defaults[props.settingKey],
              } as Partial<AppSettings>)
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={props.settings[props.settingKey]}
          onCheckedChange={(checked) =>
            props.updateSettings({
              [props.settingKey]: Boolean(checked),
            } as Partial<AppSettings>)
          }
          aria-label={props.ariaLabel}
        />
      }
    />
  );
}
