import { HiMiniArrowsPointingOut } from "react-icons/hi2";
import { TbExchange } from "react-icons/tb";
import { ChatHeaderIconButton } from "../chatHeaderControls";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";

function HeaderAction(props: {
  label: string;
  onClick: () => void;
  icon: "maximize" | "change-thread";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ChatHeaderIconButton type="button" label={props.label} onClick={props.onClick}>
            {props.icon === "maximize" ? (
              <HiMiniArrowsPointingOut className="size-3.5" />
            ) : (
              <TbExchange className="size-3.5" />
            )}
          </ChatHeaderIconButton>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function ChatHeaderLayoutControls(props: {
  layoutAction: {
    kind: "split" | "maximize";
    label: string;
    shortcutLabel: string | null;
    onClick: () => void;
  } | null;
  changeThreadAction: { label: string; onClick: () => void } | null;
}) {
  const inlineLayoutAction = props.layoutAction?.kind === "maximize" ? props.layoutAction : null;

  return (
    <>
      {inlineLayoutAction ? (
        <HeaderAction
          label={inlineLayoutAction.label}
          onClick={inlineLayoutAction.onClick}
          icon="maximize"
        />
      ) : null}
      {props.changeThreadAction ? (
        <HeaderAction
          label={props.changeThreadAction.label}
          onClick={props.changeThreadAction.onClick}
          icon="change-thread"
        />
      ) : null}
    </>
  );
}
