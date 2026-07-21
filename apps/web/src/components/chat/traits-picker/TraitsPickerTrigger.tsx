import { ChevronDownIcon, FastModeIcon, SettingsIcon } from "~/lib/icons";
import { Button } from "../../ui/button";
import { MenuTrigger } from "../../ui/menu";
import { ShortcutKbd } from "../../ui/shortcut-kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "../composerPickerStyles";

export function TraitsPickerTrigger({
  providerIsCodex,
  hideLabel,
  hiddenLabelTitle,
  primaryLabel,
  showsFastBadge,
  contextWindowLabel,
  shortcutLabel,
  isMenuOpen,
}: {
  providerIsCodex: boolean;
  hideLabel: boolean;
  hiddenLabelTitle: string;
  primaryLabel: string | null;
  showsFastBadge: boolean;
  contextWindowLabel: string | null;
  shortcutLabel: string | null | undefined;
  isMenuOpen: boolean;
}) {
  const triggerButton = (
    <Button
      size="sm"
      variant="chrome"
      className={`min-w-0 shrink-0 justify-start overflow-hidden whitespace-nowrap px-2 sm:px-2.5 [&_svg]:mx-0 ${COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME}`}
      aria-label="Change effort, context, and speed"
      {...(hideLabel && hiddenLabelTitle.length > 0 ? { title: hiddenLabelTitle } : {})}
    />
  );

  const triggerContent = hideLabel ? (
    <span className="flex min-w-0 items-center gap-1">
      <SettingsIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
      {hiddenLabelTitle.length > 0 ? <span className="sr-only">{hiddenLabelTitle}</span> : null}
      <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
    </span>
  ) : providerIsCodex ? (
    <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
      <SettingsIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
      <span className="min-w-0 flex flex-1 items-center gap-1.5 truncate">
        {primaryLabel ? (
          <span className="truncate">{primaryLabel}</span>
        ) : (
          <span className="truncate">Options</span>
        )}
        {showsFastBadge ? (
          <>
            <span className="shrink-0 text-muted-foreground/45">·</span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <FastModeIcon aria-hidden="true" className="size-3 text-[hsl(var(--chart-4))]" />
              <span>Fast</span>
            </span>
          </>
        ) : null}
        {contextWindowLabel ? (
          <>
            {primaryLabel || showsFastBadge ? (
              <span className="shrink-0 text-muted-foreground/45">·</span>
            ) : null}
            <span className="shrink-0">{contextWindowLabel}</span>
          </>
        ) : null}
      </span>
      <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
    </span>
  ) : (
    <>
      <SettingsIcon aria-hidden="true" className="size-3.5 opacity-75" />
      <span className="inline-flex items-center gap-1.5">
        <span>{primaryLabel ?? "Options"}</span>
        {showsFastBadge ? (
          <>
            <span className="text-muted-foreground/45">·</span>
            <span className="inline-flex items-center gap-1">
              <FastModeIcon aria-hidden="true" className="size-3 text-[hsl(var(--chart-4))]" />
              <span>Fast</span>
            </span>
          </>
        ) : null}
        {contextWindowLabel ? (
          <>
            {primaryLabel || showsFastBadge ? (
              <span className="text-muted-foreground/45">·</span>
            ) : null}
            <span>{contextWindowLabel}</span>
          </>
        ) : null}
      </span>
      <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
    </>
  );

  return shortcutLabel ? (
    <Tooltip>
      <TooltipTrigger render={<MenuTrigger render={triggerButton} />}>
        {triggerContent}
      </TooltipTrigger>
      {!isMenuOpen ? (
        <TooltipPopup side="top" sideOffset={6} variant="picker">
          <span className="inline-flex items-center gap-2 px-1 py-0.5">
            <span>Change effort, context, and speed</span>
            <ShortcutKbd
              shortcutLabel={shortcutLabel}
              className="h-4 min-w-4 px-1 text-[length:var(--app-font-size-ui-2xs,9px)] text-muted-foreground"
            />
          </span>
        </TooltipPopup>
      ) : null}
    </Tooltip>
  ) : (
    <MenuTrigger render={triggerButton}>{triggerContent}</MenuTrigger>
  );
}
