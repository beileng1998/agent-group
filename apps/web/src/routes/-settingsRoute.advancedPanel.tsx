import { APP_VERSION } from "../branding";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { DisclosureChevron } from "../components/ui/DisclosureChevron";
import { DisclosureRegion } from "../components/ui/DisclosureRegion";
import { SETTINGS_INSET_LIST_CLASS_NAME } from "../settingsPanelStyles";
import { cn } from "../lib/utils";

export interface AdvancedSettingsPanelProps {
  keybindingsConfigPath: string | null;
  openKeybindingsError: string | null;
  isOpeningKeybindings: boolean;
  openKeybindingsFile: () => void;
  shouldOfferRecoveryTools: boolean;
  isRepairingLocalState: boolean;
  repairLocalState: () => Promise<void> | void;
  showRecoveryTools: boolean;
  toggleRecoveryTools: () => void;
  openReleaseHistory: () => void;
  openSourceLicenses: () => void;
}

export function AdvancedSettingsPanel(props: AdvancedSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsSection title="Developer tools">
        <SettingsRow
          title="Keybindings"
          description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {props.keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {props.openKeybindingsError ? (
                <span className="mt-1 block text-destructive">{props.openKeybindingsError}</span>
              ) : (
                <span className="mt-1 block">Opens in your preferred editor.</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!props.keybindingsConfigPath || props.isOpeningKeybindings}
              onClick={props.openKeybindingsFile}
            >
              {props.isOpeningKeybindings ? "Opening..." : "Open file"}
            </Button>
          }
        />

        <SettingsRow
          title="Recovery tools"
          description="Rebuild local project indexes without clearing existing chats when the local state gets out of sync."
          status={
            props.shouldOfferRecoveryTools
              ? "Visible because projects exist but no chat history is currently available."
              : "Shown automatically only when recovery actions are relevant."
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!props.shouldOfferRecoveryTools || props.isRepairingLocalState}
              onClick={() => void props.repairLocalState()}
            >
              {props.isRepairingLocalState ? "Repairing..." : "Repair state"}
            </Button>
          }
        >
          {props.shouldOfferRecoveryTools ? (
            <div className="mt-3 border-t border-border/70 pt-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={props.toggleRecoveryTools}
              >
                <span className="text-xs font-medium text-muted-foreground">What this does</span>
                <DisclosureChevron open={props.showRecoveryTools} className="size-4" />
              </button>
              <DisclosureRegion open={props.showRecoveryTools}>
                <div
                  className={cn(
                    "mt-3 px-3 py-3 text-xs text-muted-foreground",
                    SETTINGS_INSET_LIST_CLASS_NAME,
                  )}
                >
                  Rebuilds local project indexes and refreshes project snapshots. Existing chats
                  stay in place.
                </div>
              </DisclosureRegion>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsRow
          title="Version"
          description="Current application version."
          control={<code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>}
        />
        <SettingsRow
          title="Release history"
          description="A running log of every update, newest first. Same notes the post-update dialog shows, kept here so you can revisit them any time."
          control={
            <Button size="sm" variant="outline" onClick={props.openReleaseHistory}>
              View release history
            </Button>
          }
        />
        <SettingsRow
          title="Open source licenses"
          description="View Agent Group's MIT license, Agent Group attribution, and third-party distribution notices."
          control={
            <Button size="sm" variant="outline" onClick={props.openSourceLicenses}>
              View licenses
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
