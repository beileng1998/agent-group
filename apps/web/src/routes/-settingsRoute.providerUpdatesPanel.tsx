import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProviderStatus,
} from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import type { RefObject } from "react";

import type { AppSettings } from "../appSettings";
import {
  SettingsListRow,
  SettingsRow,
  SettingsSection,
} from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { DownloadIcon, Loader2Icon } from "../lib/icons";
import { cn } from "../lib/utils";
import { SETTINGS_INSET_LIST_CLASS_NAME } from "../settingsPanelStyles";
import { SETTINGS_TARGETS } from "../settingsNavigation";
import { SettingsBooleanRow } from "./-settingsRoute.booleanRow";
import { providerUpdateStatusLabel } from "./-settingsRoute.providerCatalog";

export interface ProviderUpdatesSettingsPanelProps {
  targetRef: RefObject<HTMLDivElement | null>;
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  outdatedProviderStatuses: ReadonlyArray<ServerProviderStatus>;
  updatingProviders: ReadonlySet<ProviderKind>;
  runProviderUpdate: (provider: ProviderKind) => Promise<void> | void;
}

export function ProviderUpdatesSettingsPanel(props: ProviderUpdatesSettingsPanelProps) {
  const outdatedProviderCount = props.outdatedProviderStatuses.length;
  return (
    <div ref={props.targetRef} id={SETTINGS_TARGETS.providerUpdates}>
      <SettingsSection title="Updates">
        <SettingsBooleanRow
          settings={props.settings}
          defaults={props.defaults}
          updateSettings={props.updateSettings}
          settingKey="enableProviderUpdateChecks"
          title="Automatic CLI update checks"
          description="Check Codex, Claude, and other provider CLIs for newer versions in the background."
          resetLabel="CLI update checks"
          ariaLabel="Automatic CLI update checks"
        />

        <SettingsRow
          title="Provider updates"
          description="Review installed provider tools that Agent Group can safely update."
          status={
            !props.settings.enableProviderUpdateChecks
              ? "Automatic checks off"
              : outdatedProviderCount > 0
                ? `${outdatedProviderCount} ${pluralize(outdatedProviderCount, "update")} available`
                : "No provider updates detected"
          }
        >
          {props.settings.enableProviderUpdateChecks &&
          props.outdatedProviderStatuses.length > 0 ? (
            <div
              className={cn(
                "mt-4",
                SETTINGS_INSET_LIST_CLASS_NAME,
                "divide-y divide-[color:var(--color-border)]",
              )}
            >
              {props.outdatedProviderStatuses.map((providerStatus) => {
                const updateAdvisory = providerStatus.versionAdvisory;
                const updateState = providerStatus.updateState?.status;
                const isProviderUpdateActive =
                  updateState === "queued" ||
                  updateState === "running" ||
                  props.updatingProviders.has(providerStatus.provider);
                const canUpdateProvider =
                  updateAdvisory?.canUpdate === true && !isProviderUpdateActive;
                const updateLabel = providerUpdateStatusLabel(providerStatus);

                return (
                  <SettingsListRow
                    key={providerStatus.provider}
                    title={PROVIDER_DISPLAY_NAMES[providerStatus.provider]}
                    description={updateLabel || undefined}
                    actions={
                      updateAdvisory?.canUpdate ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={!canUpdateProvider}
                          title={
                            updateAdvisory.updateCommand
                              ? `Run ${updateAdvisory.updateCommand}`
                              : undefined
                          }
                          onClick={() => void props.runProviderUpdate(providerStatus.provider)}
                        >
                          {isProviderUpdateActive ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <DownloadIcon className="size-3.5" />
                          )}
                          {isProviderUpdateActive ? "Updating" : "Update"}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Manual update</span>
                      )
                    }
                  />
                );
              })}
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
