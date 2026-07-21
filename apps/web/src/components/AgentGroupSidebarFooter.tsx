import type { ThemeMode } from "~/theme/theme.logic";
import { useTheme } from "~/hooks/useTheme";
import {
  DeviceLaptopIcon,
  MoonIcon,
  PaletteIcon,
  PanelRightCloseIcon,
  SettingsIcon,
  SunIcon,
} from "~/lib/icons";

import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  icon: typeof SunIcon;
}> = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: DeviceLaptopIcon },
];

export function AgentGroupSidebarFooter(props: {
  readonly onOpenAppearance: () => void;
  readonly onOpenSessionInspector?: (() => void) | undefined;
  readonly onOpenSettings: () => void;
}) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const ActiveThemeIcon =
    theme === "system" ? DeviceLaptopIcon : resolvedTheme === "dark" ? MoonIcon : SunIcon;
  const resolvedThemeLabel = resolvedTheme === "dark" ? "Dark" : "Light";
  const themeLabel = theme === "system" ? `System (${resolvedThemeLabel})` : resolvedThemeLabel;

  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 justify-start font-normal"
          onClick={props.onOpenSettings}
        >
          <SettingsIcon className="size-3.5" />
          <span className="truncate">Settings</span>
        </Button>

        {props.onOpenSessionInspector ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open Session panel"
            title="Open Session panel"
            onClick={props.onOpenSessionInspector}
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        ) : null}

        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Theme: ${themeLabel}`}
                title={`Theme: ${themeLabel}`}
              />
            }
          >
            <ActiveThemeIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="end" side="top" className="w-44 min-w-44">
            <MenuGroup>
              <MenuGroupLabel>Theme</MenuGroupLabel>
              <MenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (value === "light" || value === "dark" || value === "system") {
                    setTheme(value);
                  }
                }}
              >
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <MenuRadioItem key={option.value} value={option.value}>
                      <Icon className="size-3.5" />
                      <span>{option.label}</span>
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onClick={props.onOpenAppearance}>
              <PaletteIcon className="size-3.5" />
              <span>Customize appearance</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
    </div>
  );
}
