// FILE: RightDockPlacementMenu.tsx
// Purpose: Header control for persisted Automatic / Right / Bottom dock placement.
// Layer: Chat right-dock UI

import { Columns2Icon, LayoutSidebarIcon, Rows3Icon } from "~/lib/icons";
import { Button } from "../ui/button";
import { Menu, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { DOCK_HEADER_ICON_BUTTON_CLASS } from "./chatHeaderControls";
import type {
  RightDockPlacement,
  RightDockPlacementPreference,
} from "./rightDockPlacement";

export function RightDockPlacementMenu(props: {
  preference: RightDockPlacementPreference;
  resolvedPlacement: RightDockPlacement;
  automaticPlacement: RightDockPlacement;
  onChange: (placement: RightDockPlacementPreference) => void;
}) {
  const TriggerIcon =
    props.preference === "auto"
      ? LayoutSidebarIcon
      : props.resolvedPlacement === "right"
        ? Columns2Icon
        : Rows3Icon;
  const automaticLabel = props.automaticPlacement === "right" ? "Right" : "Bottom";
  const resolvedLabel = props.resolvedPlacement === "right" ? "Right" : "Bottom";
  const triggerLabel =
    props.preference === "auto"
      ? `Panel position: Automatic (${automaticLabel})`
      : `Panel position: ${resolvedLabel}`;

  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <Button
            variant="chrome"
            size="icon-xs"
            aria-label={triggerLabel}
            title={triggerLabel}
            className={DOCK_HEADER_ICON_BUTTON_CLASS}
          />
        }
      >
        <TriggerIcon className="size-3.5" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="end" side="bottom" className="w-48 min-w-48">
        <MenuRadioGroup
          value={props.preference}
          onValueChange={(value) => {
            if (value === "auto" || value === "right" || value === "bottom") {
              props.onChange(value);
            }
          }}
        >
          <MenuRadioItem value="auto">
            <LayoutSidebarIcon className="size-3.5 shrink-0" />
            <span>Automatic</span>
            <span className="ml-auto text-xs text-muted-foreground">{automaticLabel}</span>
          </MenuRadioItem>
          <MenuRadioItem value="right">
            <Columns2Icon className="size-3.5 shrink-0" />
            <span>Right</span>
          </MenuRadioItem>
          <MenuRadioItem value="bottom">
            <Rows3Icon className="size-3.5 shrink-0" />
            <span>Bottom</span>
          </MenuRadioItem>
        </MenuRadioGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
