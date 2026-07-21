import type { ServerProviderStatus } from "@agent-group/contracts";

import type { AppSettings } from "../appSettings";
import { DebouncedSettingTextInput } from "../components/settings/DebouncedSettingTextInput";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent } from "../components/ui/collapsible";
import { DisclosureChevron } from "../components/ui/DisclosureChevron";
import { Switch } from "../components/ui/switch";
import { DownloadIcon, Loader2Icon } from "../lib/icons";
import { cn } from "../lib/utils";
import { shouldOfferProviderUpdateAction } from "../providerUpdates";
import {
  formatProviderVersion,
  type InstallProviderSettings,
  ProviderDocsLinks,
  providerUpdateStatusLabel,
} from "./-settingsRoute.providerCatalog";

type ProviderInstallTextSettingKey =
  | InstallProviderSettings["binaryPathKey"]
  | NonNullable<InstallProviderSettings["homePathKey"]>
  | NonNullable<InstallProviderSettings["agentDirKey"]>
  | NonNullable<InstallProviderSettings["apiEndpointKey"]>
  | NonNullable<InstallProviderSettings["serverUrlKey"]>
  | NonNullable<InstallProviderSettings["serverPasswordKey"]>;

export interface ProviderInstallRowProps {
  providerSettings: InstallProviderSettings;
  settings: AppSettings;
  defaults: AppSettings;
  providerStatus?: ServerProviderStatus;
  showProviderUpdateStatus: boolean;
  isOpen: boolean;
  updateRequested: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  onOpenChange: (open: boolean) => void;
  onRunProviderUpdate: () => Promise<void> | void;
}

function textSettingPatch(
  settingKey: ProviderInstallTextSettingKey,
  value: string,
): Partial<AppSettings> {
  return { [settingKey]: value } as Partial<AppSettings>;
}

export function isProviderInstallDirty(
  providerSettings: InstallProviderSettings,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return (
    settings[providerSettings.binaryPathKey] !== defaults[providerSettings.binaryPathKey] ||
    Boolean(
      providerSettings.homePathKey &&
      settings[providerSettings.homePathKey] !== defaults[providerSettings.homePathKey],
    ) ||
    Boolean(
      providerSettings.agentDirKey &&
      settings[providerSettings.agentDirKey] !== defaults[providerSettings.agentDirKey],
    ) ||
    Boolean(
      providerSettings.apiEndpointKey &&
      settings[providerSettings.apiEndpointKey] !== defaults[providerSettings.apiEndpointKey],
    ) ||
    Boolean(
      providerSettings.serverUrlKey &&
      settings[providerSettings.serverUrlKey] !== defaults[providerSettings.serverUrlKey],
    ) ||
    Boolean(
      providerSettings.serverPasswordKey &&
      settings[providerSettings.serverPasswordKey] !== defaults[providerSettings.serverPasswordKey],
    ) ||
    Boolean(
      providerSettings.experimentalWebSocketsKey &&
      settings[providerSettings.experimentalWebSocketsKey] !==
        defaults[providerSettings.experimentalWebSocketsKey],
    )
  );
}

interface ProviderTextSettingProps {
  settingKey: ProviderInstallTextSettingKey;
  label: string;
  value: string;
  placeholder?: string | undefined;
  description?: InstallProviderSettings["binaryDescription"] | undefined;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

function ProviderTextSetting(props: ProviderTextSettingProps) {
  const id = `provider-install-${props.settingKey}`;
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-foreground">{props.label}</span>
      <DebouncedSettingTextInput
        id={id}
        size="sm"
        variant="soft"
        className="mt-1"
        value={props.value}
        onCommit={(nextValue) =>
          props.updateSettings(textSettingPatch(props.settingKey, nextValue))
        }
        placeholder={props.placeholder}
        spellCheck={false}
      />
      {props.description ? (
        <span className="mt-1 block text-xs text-muted-foreground">{props.description}</span>
      ) : null}
    </label>
  );
}

export function ProviderInstallRow(props: ProviderInstallRowProps) {
  const {
    defaults,
    isOpen,
    onOpenChange,
    onRunProviderUpdate,
    providerSettings,
    providerStatus,
    settings,
    showProviderUpdateStatus,
    updateRequested,
    updateSettings,
  } = props;
  const isDirty = isProviderInstallDirty(providerSettings, settings, defaults);
  const updateAdvisory = providerStatus?.versionAdvisory;
  const providerUpdateSuppressed =
    updateAdvisory?.status === "behind_latest" && !showProviderUpdateStatus;
  const currentProviderVersion = formatProviderVersion(providerStatus?.version);
  const providerUpdateLabel = providerStatus
    ? !settings.enableProviderUpdateChecks
      ? currentProviderVersion
        ? `Current ${currentProviderVersion}`
        : null
      : providerUpdateSuppressed
        ? null
        : providerUpdateStatusLabel(providerStatus)
    : null;
  const providerUpdateState = providerStatus?.updateState?.status;
  const isProviderUpdateActive =
    providerUpdateState === "queued" || providerUpdateState === "running" || updateRequested;
  const shouldShowProviderUpdateButton = providerStatus
    ? shouldOfferProviderUpdateAction(providerStatus) &&
      (showProviderUpdateStatus || updateAdvisory?.status === "unknown")
    : false;
  const canUpdateProvider = shouldShowProviderUpdateButton && !isProviderUpdateActive;

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <div className="border-t border-border/70 first:border-t-0">
        <div className="flex min-h-11 items-center gap-2 px-3 py-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => onOpenChange(!isOpen)}
          >
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
              {providerSettings.title}
            </span>
            {isDirty ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">Custom</span>
            ) : null}
            {providerUpdateLabel ? (
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  updateAdvisory?.status === "behind_latest"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {providerUpdateLabel}
              </span>
            ) : null}
            <DisclosureChevron open={isOpen} className="size-4" />
          </button>
          {shouldShowProviderUpdateButton ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!canUpdateProvider}
              title={
                updateAdvisory?.updateCommand ? `Run ${updateAdvisory.updateCommand}` : undefined
              }
              onClick={(event) => {
                event.stopPropagation();
                void onRunProviderUpdate();
              }}
            >
              {isProviderUpdateActive ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              {isProviderUpdateActive ? "Updating" : "Update"}
            </Button>
          ) : null}
        </div>

        <CollapsibleContent>
          <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
            <div className="space-y-3">
              <ProviderDocsLinks docs={providerSettings.docs} />
              {showProviderUpdateStatus && updateAdvisory?.status === "behind_latest" ? (
                <div className="text-xs text-muted-foreground">
                  {updateAdvisory.canUpdate && updateAdvisory.updateCommand ? (
                    <>
                      <span>Command: </span>
                      <code className="font-mono">{updateAdvisory.updateCommand}</code>
                    </>
                  ) : (
                    "A newer version is available, but Agent Group could not identify a safe one-click update command for this installation."
                  )}
                </div>
              ) : null}

              <ProviderTextSetting
                settingKey={providerSettings.binaryPathKey}
                label={`${providerSettings.title} binary path`}
                value={settings[providerSettings.binaryPathKey]}
                placeholder={providerSettings.binaryPlaceholder}
                description={providerSettings.binaryDescription}
                updateSettings={updateSettings}
              />

              {providerSettings.homePathKey ? (
                <ProviderTextSetting
                  settingKey={providerSettings.homePathKey}
                  label="CODEX_HOME path"
                  value={settings[providerSettings.homePathKey]}
                  placeholder={providerSettings.homePlaceholder}
                  description={providerSettings.homeDescription}
                  updateSettings={updateSettings}
                />
              ) : null}

              {providerSettings.agentDirKey ? (
                <ProviderTextSetting
                  settingKey={providerSettings.agentDirKey}
                  label="Pi agent directory"
                  value={settings[providerSettings.agentDirKey]}
                  placeholder={providerSettings.agentDirPlaceholder}
                  description={providerSettings.agentDirDescription}
                  updateSettings={updateSettings}
                />
              ) : null}

              {providerSettings.apiEndpointKey ? (
                <ProviderTextSetting
                  settingKey={providerSettings.apiEndpointKey}
                  label="Cursor API endpoint"
                  value={settings[providerSettings.apiEndpointKey]}
                  placeholder={providerSettings.apiEndpointPlaceholder}
                  description={providerSettings.apiEndpointDescription}
                  updateSettings={updateSettings}
                />
              ) : null}

              {providerSettings.serverUrlKey ? (
                <ProviderTextSetting
                  settingKey={providerSettings.serverUrlKey}
                  label={`${providerSettings.title} server URL`}
                  value={settings[providerSettings.serverUrlKey]}
                  placeholder={providerSettings.serverUrlPlaceholder}
                  description={providerSettings.serverUrlDescription}
                  updateSettings={updateSettings}
                />
              ) : null}

              {providerSettings.serverPasswordKey ? (
                <ProviderTextSetting
                  settingKey={providerSettings.serverPasswordKey}
                  label={`${providerSettings.title} server password`}
                  value={settings[providerSettings.serverPasswordKey]}
                  placeholder={providerSettings.serverPasswordPlaceholder}
                  description={providerSettings.serverPasswordDescription}
                  updateSettings={updateSettings}
                />
              ) : null}

              {providerSettings.experimentalWebSocketsKey ? (
                <label
                  htmlFor={`provider-install-${providerSettings.experimentalWebSocketsKey}`}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">
                      OpenAI response WebSockets
                    </span>
                    {providerSettings.experimentalWebSocketsDescription ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {providerSettings.experimentalWebSocketsDescription}
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    id={`provider-install-${providerSettings.experimentalWebSocketsKey}`}
                    checked={settings[providerSettings.experimentalWebSocketsKey]}
                    onCheckedChange={(checked) =>
                      updateSettings({ openCodeExperimentalWebSockets: Boolean(checked) })
                    }
                  />
                </label>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
