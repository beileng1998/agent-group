import type { AppSettings } from "../appSettings";
import { SettingResetButton } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import {
  buildNotificationSettingsSupportText,
  type BrowserNotificationPermissionState,
} from "../notifications/taskCompletion";
import { SettingsBooleanRow } from "./-settingsRoute.booleanRow";

export interface NotificationsSettingsPanelProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  browserNotificationPermission: BrowserNotificationPermissionState;
  setSystemNotificationsEnabled: (enabled: boolean) => Promise<void> | void;
  sendTestNotification: () => Promise<void> | void;
}

export function NotificationsSettingsPanel(props: NotificationsSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsSection title="Activity alerts">
        <SettingsBooleanRow
          settings={props.settings}
          defaults={props.defaults}
          updateSettings={props.updateSettings}
          settingKey="enableTaskCompletionToasts"
          title="Activity toasts"
          description="Show an in-app toast when a chat or managed terminal agent finishes or needs input."
          resetLabel="activity toasts"
          ariaLabel="Activity toast notifications"
        />

        <SettingsRow
          title="Desktop notifications"
          description="Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background."
          status={buildNotificationSettingsSupportText(props.browserNotificationPermission)}
          resetAction={
            props.settings.enableSystemTaskCompletionNotifications !==
            props.defaults.enableSystemTaskCompletionNotifications ? (
              <SettingResetButton
                label="desktop notifications"
                onClick={() =>
                  props.updateSettings({
                    enableSystemTaskCompletionNotifications:
                      props.defaults.enableSystemTaskCompletionNotifications,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              <Button size="xs" variant="outline" onClick={() => void props.sendTestNotification()}>
                Test
              </Button>
              <Switch
                checked={props.settings.enableSystemTaskCompletionNotifications}
                onCheckedChange={(checked) => {
                  void props.setSystemNotificationsEnabled(Boolean(checked));
                }}
                aria-label="Desktop activity notifications"
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
