import type { DesktopAppSnapState } from "@agent-group/contracts";

import type { AppSettings } from "../appSettings";
import { SettingResetButton } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { Kbd, KbdGroup } from "../components/ui/kbd";
import { Switch } from "../components/ui/switch";
import { CentralIcon } from "../lib/central-icons";
import {
  SETTINGS_CARD_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "../settingsPanelStyles";
import { cn } from "../lib/utils";
import { AppSnapPermissionBadge, appSnapStatusText } from "./-settingsRoute.options";

export interface AppSnapSettingsPanelProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  appSnapState: DesktopAppSnapState | null;
  setAppSnapEnabled: (enabled: boolean) => Promise<void> | void;
  recheckAppSnapPermissions: () => Promise<void> | void;
  previewCaptureSound: () => Promise<void> | void;
}

export function AppSnapSettingsPanel(props: AppSnapSettingsPanelProps) {
  const appSnapState = props.appSnapState;
  const supported = appSnapState?.supported === true;
  const enabled = supported && props.settings.enableAppSnap;
  return (
    <div className="space-y-6">
      <div className={cn(SETTINGS_CARD_CLASS_NAME, "flex items-start gap-3 px-4 py-3.5")}>
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border)] text-muted-foreground">
          <CentralIcon name="screen-capture" className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
            Take an AppSnap to show your agent another app's window
          </p>
          <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
            Press both <Kbd className="mx-px">⌥ Option</Kbd> keys at once while any app is
            frontmost. Agent Group captures that window as an image, brings itself forward, and
            attaches the snap to a task composer — the capture stays on this device until you send
            the message.
          </p>
          {!supported ? (
            <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "pt-0.5")}>
              {appSnapState
                ? (appSnapState.message ?? "AppSnap is available only in the macOS desktop app.")
                : "AppSnap requires the Agent Group desktop app on macOS."}
            </p>
          ) : null}
        </div>
      </div>

      <SettingsSection title="Capture">
        <SettingsRow
          title="Enable AppSnap"
          description="Run the capture listener in the background while Agent Group is open."
          status={appSnapStatusText(appSnapState)}
          resetAction={
            props.settings.enableAppSnap !== props.defaults.enableAppSnap ? (
              <SettingResetButton
                label="AppSnap"
                onClick={() => void props.setAppSnapEnabled(props.defaults.enableAppSnap)}
              />
            ) : null
          }
          control={
            <Switch
              checked={enabled}
              disabled={!supported}
              onCheckedChange={(checked) => void props.setAppSnapEnabled(Boolean(checked))}
              aria-label="Enable AppSnap"
            />
          }
        />

        <SettingsRow
          title="Shortcut"
          description="Press the left and right Option keys at the same time. The chord works while any app is focused, and can't be remapped yet."
          control={
            <KbdGroup>
              <Kbd>⌥ left</Kbd>
              <span className="text-xs text-muted-foreground">+</span>
              <Kbd>⌥ right</Kbd>
            </KbdGroup>
          }
        />

        <SettingsRow
          title="Destination"
          description="Snaps join the task you interacted with in the last minute, and consecutive snaps stay together. Otherwise Agent Group opens a fresh task with the capture attached."
          control={<span className="text-xs font-medium text-muted-foreground">Automatic</span>}
        />

        <SettingsRow
          title="Capture sound"
          description="Play a short shutter cue when a window is captured."
          resetAction={
            props.settings.appSnapPlaySound !== props.defaults.appSnapPlaySound ? (
              <SettingResetButton
                label="capture sound"
                onClick={() =>
                  props.updateSettings({ appSnapPlaySound: props.defaults.appSnapPlaySound })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              <Button size="xs" variant="outline" onClick={() => void props.previewCaptureSound()}>
                Preview
              </Button>
              <Switch
                checked={props.settings.appSnapPlaySound}
                onCheckedChange={(checked) =>
                  props.updateSettings({ appSnapPlaySound: Boolean(checked) })
                }
                aria-label="Play a sound when an AppSnap is captured"
              />
            </div>
          }
        />
      </SettingsSection>

      {supported ? (
        <SettingsSection title="macOS permissions">
          <SettingsRow
            title="Input Monitoring"
            description="Lets Agent Group notice the double-Option chord while another app owns the keyboard. Nothing you type is recorded."
            control={<AppSnapPermissionBadge permission={appSnapState.inputMonitoringPermission} />}
          />
          <SettingsRow
            title="Screen Recording"
            description="Lets Agent Group capture an image of the frontmost window. Only the single window you snap is captured, only at the moment you press the chord."
            control={<AppSnapPermissionBadge permission={appSnapState.screenRecordingPermission} />}
          />
          <SettingsRow
            title="Permission status"
            description="Grant both permissions to Agent Group under System Settings → Privacy & Security, then recheck here. macOS may require relaunching the app after a change."
            control={
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void props.recheckAppSnapPermissions()}
              >
                Recheck permissions
              </Button>
            }
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}
