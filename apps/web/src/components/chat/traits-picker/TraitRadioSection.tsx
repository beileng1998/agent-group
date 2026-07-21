import type { ReactNode } from "react";
import { MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem } from "../../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";

interface TraitRadioOption {
  value: string;
  label: string;
  isDefault?: boolean;
  description?: string | null;
}

// Shared layout for one composer trait section: a labeled radio group whose rows
// optionally show a "(default)" suffix and a right-side description tooltip.
// `onSelectionComplete` runs on every row click so re-selecting the active row closes the menu.
export function TraitRadioSection({
  label,
  note,
  value,
  options,
  disabled,
  onValueChange,
  onSelectionComplete,
}: {
  label: string;
  note?: ReactNode;
  value: string;
  options: ReadonlyArray<TraitRadioOption>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSelectionComplete?: (() => void) | undefined;
}) {
  return (
    <MenuGroup>
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {note}
      <MenuRadioGroup value={value} onValueChange={onValueChange}>
        {options.map((option) => {
          const item = (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              {...(disabled ? { disabled: true } : {})}
              onClick={() => onSelectionComplete?.()}
            >
              {option.label}
              {option.isDefault ? " (default)" : ""}
            </MenuRadioItem>
          );
          return option.description ? (
            <Tooltip key={option.value}>
              <TooltipTrigger render={item} />
              <TooltipPopup
                side="right"
                variant="picker"
                className="max-w-80 whitespace-normal leading-tight"
              >
                {option.description}
              </TooltipPopup>
            </Tooltip>
          ) : (
            item
          );
        })}
      </MenuRadioGroup>
    </MenuGroup>
  );
}
