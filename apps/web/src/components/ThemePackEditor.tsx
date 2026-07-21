// FILE: ThemePackEditor.tsx
// Purpose: Composes one editable light or dark theme pack card.
// Layer: Web settings UI

import { useMemo } from "react";
import { copyTextToClipboard } from "../hooks/useCopyToClipboard";
import { type ThemeMode, type ThemeVariant, useTheme } from "../hooks/useTheme";
import { cn } from "../lib/utils";
import {
  SETTINGS_CARD_CLASS_NAME,
  SETTINGS_CONTROL_RADIUS_CLASS_NAME,
} from "../settingsPanelStyles";
import {
  CODE_THEME_OPTIONS,
  DEFAULT_THEME_STATE,
  getAvailableCodeThemes,
  getCodeThemeSeed,
  resolveThemePack,
} from "../theme/theme.logic";
import { SettingsSelectPopup } from "./settings/SettingsPanelPrimitives";
import {
  CodeThemeSelectOption,
  ColorPill,
  ContrastSlider,
  FontInput,
  ThemeRow,
} from "./theme-pack/ThemePackControls";
import { ImportThemeDialog } from "./theme-pack/ImportThemeDialog";
import { Select, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";

type ThemePackEditorProps = {
  isActive?: boolean;
  mode?: ThemeMode;
  variant: ThemeVariant;
};

export function ThemePackEditor({
  variant,
  isActive = false,
  mode = "system",
}: ThemePackEditorProps) {
  const {
    darkTheme,
    lightTheme,
    exportThemeString,
    importThemeString,
    isDefaultThemePack,
    resetThemeVariant,
    setCodeThemeId,
    updateThemePack,
    updateThemeFonts,
  } = useTheme();

  const pack = variant === "dark" ? darkTheme : lightTheme;
  const theme = pack.theme;
  const defaultTheme = resolveThemePack(DEFAULT_THEME_STATE, variant).theme;
  const codeThemes = useMemo(() => {
    const options = getAvailableCodeThemes(variant);
    return options.map((option) => ({
      id: option.id,
      label: option.label,
      previewTheme: getCodeThemeSeed(option.id, variant),
      variants: option.variants,
    }));
  }, [variant]);
  const codeThemeLabel =
    CODE_THEME_OPTIONS.find((option) => option.id === pack.codeThemeId)?.label ?? pack.codeThemeId;
  const isPristine = isDefaultThemePack(variant);
  const titleLabel = variant === "dark" ? "Dark theme" : "Light theme";
  const contextLabel = isActive
    ? mode === "system"
      ? `System is currently using this ${variant} slot.`
      : "This is the active theme right now."
    : mode === "system"
      ? `Used when your system switches to ${variant}.`
      : `Inactive while the app is locked to ${mode}.`;

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(exportThemeString(variant));
      toastManager.add({
        type: "success",
        title: "Theme copied",
        description: `Copied the ${variant} theme share string.`,
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Copy failed",
        description: "Unable to copy the theme share string.",
      });
    }
  };

  return (
    <div className={cn(SETTINGS_CARD_CLASS_NAME, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{titleLabel}</h3>
          {!isPristine ? (
            <button
              type="button"
              onClick={() => resetThemeVariant(variant)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
            >
              Reset
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <ImportThemeDialog
            variant={variant}
            onImport={(value) => importThemeString(value, variant)}
          />
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md px-2 py-1 text-xs text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          >
            Copy
          </button>
          <Select
            value={pack.codeThemeId}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              setCodeThemeId(variant, value);
            }}
          >
            <SelectTrigger
              size="sm"
              className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "ml-1 min-w-52 gap-2")}
              aria-label={`${titleLabel} code theme`}
            >
              <SelectValue className="flex-1 text-left">
                <CodeThemeSelectOption label={codeThemeLabel} theme={theme} />
              </SelectValue>
            </SelectTrigger>
            <SettingsSelectPopup align="end" alignItemWithTrigger={false} className="p-1.5">
              {codeThemes.map((option) => (
                <SelectItem
                  hideIndicator
                  key={option.id}
                  value={option.id}
                  className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "px-2 py-2")}
                >
                  <CodeThemeSelectOption label={option.label} theme={option.previewTheme} />
                </SelectItem>
              ))}
            </SettingsSelectPopup>
          </Select>
        </div>
      </div>
      <div className="border-b border-[color:var(--color-border)] px-4 pb-3 text-[11px] text-[var(--color-text-foreground-secondary)]">
        {contextLabel}
      </div>

      <div className="divide-y divide-[color:var(--color-border)]">
        <ThemeRow label="Accent">
          <ColorPill
            color={theme.accent}
            ariaLabel={`${titleLabel} accent color`}
            onChange={(accent) => updateThemePack(variant, { accent })}
            onReset={
              theme.accent !== defaultTheme.accent
                ? () => updateThemePack(variant, { accent: defaultTheme.accent })
                : undefined
            }
          />
        </ThemeRow>
        <ThemeRow label="Background">
          <ColorPill
            color={theme.surface}
            ariaLabel={`${titleLabel} background color`}
            onChange={(surface) => updateThemePack(variant, { surface })}
            onReset={
              theme.surface !== defaultTheme.surface
                ? () => updateThemePack(variant, { surface: defaultTheme.surface })
                : undefined
            }
          />
        </ThemeRow>
        <ThemeRow label="Foreground">
          <ColorPill
            color={theme.ink}
            ariaLabel={`${titleLabel} foreground color`}
            onChange={(ink) => updateThemePack(variant, { ink })}
            onReset={
              theme.ink !== defaultTheme.ink
                ? () => updateThemePack(variant, { ink: defaultTheme.ink })
                : undefined
            }
          />
        </ThemeRow>
        <ThemeRow label="UI font">
          <div className="flex flex-col items-end gap-1">
            <FontInput
              value={theme.fonts.ui ?? ""}
              placeholder="System default"
              ariaLabel={`${titleLabel} UI font`}
              onChange={(ui) => updateThemeFonts(variant, { ui: ui.length > 0 ? ui : null })}
            />
          </div>
        </ThemeRow>
        <ThemeRow label="Code font">
          <div className="flex flex-col items-end gap-1">
            <FontInput
              value={theme.fonts.code ?? ""}
              placeholder='"JetBrains Mono"'
              ariaLabel={`${titleLabel} code font`}
              mono
              onChange={(code) =>
                updateThemeFonts(variant, { code: code.length > 0 ? code : null })
              }
            />
          </div>
        </ThemeRow>
        <ThemeRow label="Translucent sidebar">
          <Switch
            checked={!theme.opaqueWindows}
            onCheckedChange={(checked) => updateThemePack(variant, { opaqueWindows: !checked })}
            aria-label={`${titleLabel} translucent sidebar`}
          />
        </ThemeRow>
        <ThemeRow label="Contrast">
          <ContrastSlider
            value={theme.contrast}
            onChange={(contrast) => updateThemePack(variant, { contrast })}
            ariaLabel={`${titleLabel} contrast`}
          />
        </ThemeRow>
      </div>
    </div>
  );
}
