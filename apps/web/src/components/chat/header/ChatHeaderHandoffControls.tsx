import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@agent-group/contracts";
import { ArrowRightIcon, HandoffIcon } from "~/lib/icons";
import { Badge } from "../../ui/badge";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ChatHeaderButton } from "../chatHeaderControls";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { HeaderProviderIcon } from "./ChatHeaderIdentity";

export function ChatHeaderHandoffBadge(props: {
  label: string | null;
  sourceProvider: ProviderKind | null;
  targetProvider: ProviderKind | null;
}) {
  if (!props.label) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className="hidden !h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] sm:inline-flex"
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              <HeaderProviderIcon provider={props.sourceProvider} className="size-3" />
            </span>
            <ArrowRightIcon className="size-2.5 shrink-0 opacity-45" />
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              <HeaderProviderIcon provider={props.targetProvider} className="size-3" />
            </span>
          </Badge>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function ChatHeaderHandoffMenu(props: {
  compact: boolean;
  actionLabel: string;
  disabled: boolean;
  targetProviders: ReadonlyArray<ProviderKind>;
  onCreateHandoff: (targetProvider: ProviderKind) => void;
}) {
  return (
    <Menu modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ChatHeaderButton
                  type="button"
                  tone="outline"
                  className={props.compact ? "gap-1" : "gap-1.5"}
                  aria-label={props.actionLabel}
                  disabled={props.disabled || props.targetProviders.length === 0}
                />
              }
            >
              <HandoffIcon className="size-[1em] shrink-0 opacity-80" />
              {!props.compact ? <span className="truncate font-normal">Hand off</span> : null}
            </MenuTrigger>
          }
        />
        <TooltipPopup side="bottom">{props.actionLabel}</TooltipPopup>
      </Tooltip>
      <ComposerPickerMenuPopup align="end" side="bottom" className="w-48 min-w-48">
        {props.targetProviders.map((provider) => (
          <MenuItem key={provider} onClick={() => props.onCreateHandoff(provider)}>
            <HeaderProviderIcon provider={provider} className="size-3.5 shrink-0" />
            <span>Handoff to {PROVIDER_DISPLAY_NAMES[provider]}</span>
          </MenuItem>
        ))}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
