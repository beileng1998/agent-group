import type { ProviderKind } from "@agent-group/contracts";
import type { KeyboardEvent } from "react";

import { CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS } from "../appSettings";
import { SettingResetButton } from "../components/settings/SettingControls";
import {
  SettingsRow,
  SettingsSection,
  SettingsSelectPopup,
} from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { PlusIcon, XIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import {
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
} from "../settingsPanelStyles";
import { isProviderSelectOption } from "./-settingsRoute.options";

export interface CustomModelSettingsRow {
  key: string;
  provider: ProviderKind;
  providerTitle: string;
  slug: string;
}

export interface ModelsSettingsPanelProps {
  selectedProvider: ProviderKind;
  selectedProviderTitle: string;
  selectedProviderExample: string;
  selectedInput: string;
  selectedError: string | null;
  savedRows: ReadonlyArray<CustomModelSettingsRow>;
  visibleRows: ReadonlyArray<CustomModelSettingsRow>;
  showAll: boolean;
  onSelectProvider: (provider: ProviderKind) => void;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (provider: ProviderKind, slug: string) => void;
  onToggleShowAll: () => void;
  onReset: () => void;
}

export function ModelsSettingsPanel(props: ModelsSettingsPanelProps) {
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    props.onAdd();
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Custom models">
        <SettingsRow
          title="Saved model slugs"
          description="Add custom model slugs for supported providers."
          resetAction={
            props.savedRows.length > 0 ? (
              <SettingResetButton label="custom models" onClick={props.onReset} />
            ) : null
          }
        >
          <div className={cn("mt-4 pt-4", SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME)}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={props.selectedProvider}
                onValueChange={(value) => {
                  if (!value || !isProviderSelectOption(value)) return;
                  props.onSelectProvider(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label="Custom model provider"
                >
                  <SelectValue>{props.selectedProviderTitle}</SelectValue>
                </SelectTrigger>
                <SettingsSelectPopup align="start">
                  {CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.map((providerSettings) => (
                    <SelectItem
                      hideIndicator
                      key={providerSettings.provider}
                      value={providerSettings.provider}
                    >
                      {providerSettings.title}
                    </SelectItem>
                  ))}
                </SettingsSelectPopup>
              </Select>
              <Input
                id="custom-model-slug"
                size="sm"
                variant="soft"
                value={props.selectedInput}
                onChange={(event) => props.onInputChange(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={props.selectedProviderExample}
                spellCheck={false}
              />
              <Button className="shrink-0" variant="outline" onClick={props.onAdd}>
                <PlusIcon className="size-3.5" />
                Add
              </Button>
            </div>

            {props.selectedError ? (
              <p className="mt-2 text-xs text-destructive">{props.selectedError}</p>
            ) : null}

            {props.savedRows.length > 0 ? (
              <div className={cn("mt-3", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {props.visibleRows.map((row) => (
                  <div
                    key={row.key}
                    className="group grid grid-cols-[minmax(5rem,6rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--color-border)] px-4 py-2 first:border-t-0"
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      {row.providerTitle}
                    </span>
                    <code className="min-w-0 truncate text-sm text-foreground">{row.slug}</code>
                    <button
                      type="button"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
                      aria-label={`Remove ${row.slug}`}
                      onClick={() => props.onRemove(row.provider, row.slug)}
                    >
                      <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                ))}

                {props.savedRows.length > 5 ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={props.onToggleShowAll}
                  >
                    {props.showAll ? "Show less" : `Show more (${props.savedRows.length - 5})`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
