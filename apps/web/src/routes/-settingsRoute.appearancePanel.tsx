// FILE: -settingsRoute.appearancePanel.tsx
// Purpose: Render theme, typography, density, highlight, and time preferences.
// Layer: Settings route panel

import type { AppSettings } from "../appSettings";
import {
  DEFAULT_UI_DENSITY,
  MAX_CHAT_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  normalizeChatFontSizePx,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSizePx,
} from "../appSettings";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../components/ui/autocomplete";
import { Input } from "../components/ui/input";
import { SelectItem } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import {
  SettingResetButton,
  SettingsSegmentedControl,
  SettingsSelectControl,
} from "../components/settings/SettingControls";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "../components/settings/SettingsPanelPrimitives";
import { ThemePackEditor } from "../components/ThemePackEditor";
import { MARKER_COLORS, MARKER_SWATCH_CLASS } from "../components/chat/markerColors";
import type { ThemeMode, ThemeVariant } from "../hooks/useTheme";
import { isUiDensity } from "../lib/appDensity";
import { cn } from "../lib/utils";
import {
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "../settingsPanelStyles";
import { SettingsBooleanRow } from "./-settingsRoute.booleanRow";
import {
  THEME_OPTIONS,
  TIMESTAMP_FORMAT_LABELS,
  UI_DENSITY_OPTIONS,
} from "./-settingsRoute.options";

export interface SettingsAppearancePanelProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  theme: ThemeMode;
  resolvedTheme: ThemeVariant;
  setTheme: (theme: ThemeMode) => void;
  systemUiFont: boolean;
  setSystemUiFont: (enabled: boolean) => void;
  shouldShowFontSmoothing: boolean;
  visibleTerminalFontFamilySuggestions: ReadonlyArray<string>;
}

export function SettingsAppearancePanel(props: SettingsAppearancePanelProps) {
  const {
    defaults,
    resolvedTheme,
    setSystemUiFont,
    setTheme,
    settings,
    shouldShowFontSmoothing,
    systemUiFont,
    theme,
    updateSettings,
    visibleTerminalFontFamilySuggestions,
  } = props;

  return (
    <div className="space-y-6">
      <section className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
        <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>Theme and typography</h2>
        <SettingsCard>
          <SettingsRow
            title="Theme"
            description="Choose how Agent Group looks across the app."
            resetAction={
              theme !== "system" ? (
                <SettingResetButton label="theme" onClick={() => setTheme("system")} />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={theme}
                onValueChange={(value) => {
                  if (value !== "system" && value !== "light" && value !== "dark") return;
                  setTheme(value);
                }}
                ariaLabel="Theme preference"
                options={THEME_OPTIONS}
              />
            }
          />
          <SettingsRow
            title="Use system UI font"
            description="Ignore the theme's custom UI font and render the interface with the native system font (SF Pro on macOS)."
            resetAction={
              !systemUiFont ? (
                <SettingResetButton label="system UI font" onClick={() => setSystemUiFont(true)} />
              ) : null
            }
            control={
              <Switch
                checked={systemUiFont}
                onCheckedChange={(checked) => setSystemUiFont(Boolean(checked))}
                aria-label="Use system UI font"
              />
            }
          />
        </SettingsCard>

        <div className="space-y-3">
          {(resolvedTheme === "dark"
            ? (["dark", "light"] as const)
            : (["light", "dark"] as const)
          ).map((variant) => (
            <ThemePackEditor
              key={variant}
              variant={variant}
              isActive={resolvedTheme === variant}
              mode={theme}
            />
          ))}
        </div>

        <SettingsCard>
          <SettingsRow
            title="UI density"
            description="Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size."
            resetAction={
              settings.uiDensity !== defaults.uiDensity ? (
                <SettingResetButton
                  label="UI density"
                  onClick={() =>
                    updateSettings({
                      uiDensity: DEFAULT_UI_DENSITY,
                    })
                  }
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={settings.uiDensity}
                onValueChange={(value) => {
                  if (!isUiDensity(value)) {
                    return;
                  }
                  updateSettings({ uiDensity: value });
                }}
                ariaLabel="UI density"
                options={UI_DENSITY_OPTIONS}
              />
            }
          />

          <SettingsRow
            title="Base font size"
            description="Adjust the app text base in pixels. Chat and UI typography scale proportionally from this value."
            resetAction={
              settings.chatFontSizePx !== defaults.chatFontSizePx ? (
                <SettingResetButton
                  label="base font size"
                  onClick={() =>
                    updateSettings({
                      chatFontSizePx: defaults.chatFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_CHAT_FONT_SIZE_PX}
                  max={MAX_CHAT_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.chatFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      chatFontSizePx: normalizeChatFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label="Base font size in pixels"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            title="Terminal font size"
            description="Adjust terminal text independently from the app and chat font size."
            resetAction={
              settings.terminalFontSizePx !== defaults.terminalFontSizePx ? (
                <SettingResetButton
                  label="terminal font size"
                  onClick={() =>
                    updateSettings({
                      terminalFontSizePx: defaults.terminalFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_TERMINAL_FONT_SIZE_PX}
                  max={MAX_TERMINAL_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.terminalFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      terminalFontSizePx: normalizeTerminalFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label="Terminal font size in pixels"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            title="Terminal font"
            description="Type any monospace font installed on this device (e.g. Fira Code). Leave empty for the default. Fonts that aren't installed fall back to the system monospace."
            resetAction={
              settings.terminalFontFamily !== defaults.terminalFontFamily ? (
                <SettingResetButton
                  label="terminal font"
                  onClick={() =>
                    updateSettings({
                      terminalFontFamily: defaults.terminalFontFamily,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end sm:w-auto">
                <Autocomplete
                  items={visibleTerminalFontFamilySuggestions}
                  mode="none"
                  openOnInputClick
                  value={settings.terminalFontFamily}
                  onValueChange={(value) => {
                    updateSettings({
                      terminalFontFamily: normalizeTerminalFontFamily(value),
                    });
                  }}
                >
                  <AutocompleteInput
                    size="sm"
                    variant="soft"
                    showTrigger
                    showClear={settings.terminalFontFamily.length > 0}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="Default (JetBrains Mono)"
                    className="w-full sm:w-56"
                    aria-label="Terminal font family"
                  />
                  <AutocompletePopup className="w-56 min-w-56 font-system-ui">
                    <AutocompleteList>
                      {visibleTerminalFontFamilySuggestions.map((suggestion, index) => (
                        <AutocompleteItem
                          key={suggestion}
                          index={index}
                          value={suggestion}
                          className="font-normal text-[var(--color-text-foreground)]"
                          onClick={() => {
                            updateSettings({
                              terminalFontFamily: normalizeTerminalFontFamily(suggestion),
                            });
                          }}
                        >
                          {suggestion}
                        </AutocompleteItem>
                      ))}
                      <AutocompleteEmpty>No matching suggested fonts.</AutocompleteEmpty>
                    </AutocompleteList>
                  </AutocompletePopup>
                </Autocomplete>
              </div>
            }
          />

          {shouldShowFontSmoothing ? (
            <SettingsBooleanRow
              settings={settings}
              defaults={defaults}
              updateSettings={updateSettings}
              settingKey="enableNativeFontSmoothing"
              title="Font smoothing"
              description="Use macOS-style antialiasing for lighter, crisper text rendering."
              resetLabel="font smoothing"
              ariaLabel="Enable font smoothing"
            />
          ) : null}
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            title="Default highlight color"
            description="Color used when you highlight transcript text. Click any highlight in the transcript to recolor or remove it."
            resetAction={
              settings.defaultThreadMarkerColor !== defaults.defaultThreadMarkerColor ? (
                <SettingResetButton
                  label="default highlight color"
                  onClick={() =>
                    updateSettings({
                      defaultThreadMarkerColor: defaults.defaultThreadMarkerColor,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex items-center gap-1.5">
                {MARKER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`${color} highlight`}
                    aria-pressed={settings.defaultThreadMarkerColor === color}
                    title={color}
                    onClick={() => updateSettings({ defaultThreadMarkerColor: color })}
                    className={cn(
                      "size-5 rounded-full transition-transform hover:scale-110",
                      MARKER_SWATCH_CLASS[color],
                      settings.defaultThreadMarkerColor === color
                        ? "outline outline-2 outline-offset-1 outline-[var(--color-text-foreground)]"
                        : "",
                    )}
                  />
                ))}
              </div>
            }
          />
        </SettingsCard>
      </section>

      <SettingsSection title="Time and reading">
        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== defaults.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: defaults.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value !== "locale" && value !== "12-hour" && value !== "24-hour") {
                  return;
                }
                updateSettings({
                  timestampFormat: value,
                });
              }}
              ariaLabel="Timestamp format"
              triggerClassName="w-full sm:w-40"
              valueContent={TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}
            >
              <SelectItem hideIndicator value="locale">
                {TIMESTAMP_FORMAT_LABELS.locale}
              </SelectItem>
              <SelectItem hideIndicator value="12-hour">
                {TIMESTAMP_FORMAT_LABELS["12-hour"]}
              </SelectItem>
              <SelectItem hideIndicator value="24-hour">
                {TIMESTAMP_FORMAT_LABELS["24-hour"]}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>
    </div>
  );
}
