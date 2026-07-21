// FILE: ChatComposerSection.tsx
// Purpose: Render the complete chat composer surface from grouped presentation models.
// Layer: Chat composer presentation

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from "react";
import { GoTasklist } from "react-icons/go";

import { LayoutSidebarIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { RuntimeUsageControls } from "../BranchToolbar";
import { ComposerPromptEditor } from "../ComposerPromptEditor";
import { Button } from "../ui/button";
import { ComposerColumnFrame } from "./ComposerColumnFrame";
import { ComposerExtrasMenu } from "./ComposerExtrasMenu";
import { ComposerInputBanners } from "./ComposerInputBanners";
import { ComposerMenuOverlay, type ComposerMenuOverlayModel } from "./ComposerMenuOverlay";
import { ComposerModelControls, type ComposerModelControlsModel } from "./ComposerModelControls";
import { ComposerPrimaryAction, type ComposerPrimaryActionModel } from "./ComposerPrimaryAction";
import { ComposerReferenceAttachments } from "./ComposerReferenceAttachments";
import { ComposerStackedActivityRail } from "./ComposerStackedActivityRail";
import { ComposerVoiceRecorderBar } from "./ComposerVoiceRecorderBar";
import {
  COMPOSER_COLUMN_FRAME_CLASS_NAME,
  COMPOSER_EDITOR_PADDING_CLASS_NAME,
  COMPOSER_FOOTER_ROW_CLASS_NAME,
  COMPOSER_INPUT_SHELL_CLASS_NAME,
  COMPOSER_INPUT_SURFACE_CLASS_NAME,
} from "./composerPickerStyles";
import { ContextWindowMeter } from "./ContextWindowMeter";

export interface ComposerLeadingControlsModel {
  extras: ComponentProps<typeof ComposerExtrasMenu>;
  runtimeUsage: Omit<ComponentProps<typeof RuntimeUsageControls>, "className" | "hideLabel">;
  voiceActive: boolean;
}

export function ComposerLeadingControls({
  model,
  iconOnly,
}: {
  model: ComposerLeadingControlsModel;
  iconOnly: boolean;
}) {
  return (
    <>
      <ComposerExtrasMenu {...model.extras} />
      {!model.voiceActive ? (
        <RuntimeUsageControls {...model.runtimeUsage} className="shrink-0" hideLabel={iconOnly} />
      ) : null}
    </>
  );
}

interface ComposerPlanModeControl {
  onClick: NonNullable<ComponentProps<typeof Button>["onClick"]>;
}

interface ComposerPlanSidebarControl {
  label: string;
  title: string;
  onClick: NonNullable<ComponentProps<typeof Button>["onClick"]>;
}

export interface ChatComposerSectionModel {
  frame: {
    visible: boolean;
    centeredEmptyLanding: boolean;
    form: Pick<ComponentProps<"form">, "ref" | "onSubmit"> & {
      paneScopeId: string;
    };
    shell: {
      providerClassName: string;
      surfaceClassName: string;
      menuVisible: boolean;
    };
  };
  activity: ComponentProps<typeof ComposerStackedActivityRail>;
  editor: {
    banners: ComponentProps<typeof ComposerInputBanners>;
    menu: ComposerMenuOverlayModel;
    references: ComponentProps<typeof ComposerReferenceAttachments> | null;
    prompt: ComponentPropsWithRef<typeof ComposerPromptEditor>;
  };
  footer: {
    hidden: boolean;
    compact: boolean;
    voiceActive: boolean;
    leading: {
      relocated: boolean;
      controls: ComposerLeadingControlsModel;
      planMode: ComposerPlanModeControl | null;
      planSidebar: ComposerPlanSidebarControl | null;
    };
    actions: {
      contextMeter: ComponentProps<typeof ContextWindowMeter> | null;
      modelControls: ComposerModelControlsModel;
      voiceRecorder: ComponentProps<typeof ComposerVoiceRecorderBar> | null;
      primary: ComposerPrimaryActionModel;
    };
  };
  landing: {
    controls: ReactNode;
  };
  deferred: {
    placeholderHeight: number;
  };
}

function ComposerFooter({ model }: { model: ChatComposerSectionModel["footer"] }) {
  if (model.hidden) {
    return null;
  }

  return (
    <div
      data-chat-composer-footer="true"
      className={cn(
        "@container",
        COMPOSER_FOOTER_ROW_CLASS_NAME,
        model.compact ? "gap-1.5" : "flex-wrap gap-1.5 sm:flex-nowrap sm:gap-0",
      )}
    >
      <div
        data-chat-composer-leading="true"
        className={cn(
          "flex items-center",
          model.voiceActive
            ? "min-w-0 shrink-0 gap-1"
            : model.compact
              ? "min-w-0 flex-1 gap-1 overflow-hidden"
              : "min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible",
        )}
      >
        {model.leading.relocated ? null : (
          <ComposerLeadingControls model={model.leading.controls} iconOnly={false} />
        )}

        {!model.voiceActive ? (
          <>
            {model.leading.planMode ? (
              <Button
                variant="ghost"
                className="shrink-0 whitespace-nowrap px-2 text-[length:var(--app-font-size-ui-sm,11px)] sm:text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] sm:px-3"
                size="sm"
                type="button"
                onClick={model.leading.planMode.onClick}
                title="Plan mode — click to return to normal build mode"
              >
                <GoTasklist className="size-3.5" />
                <span className="sr-only sm:not-sr-only">Plan</span>
              </Button>
            ) : null}

            {model.leading.planSidebar ? (
              <Button
                variant="ghost"
                className="shrink-0 whitespace-nowrap px-2 text-[length:var(--app-font-size-ui-sm,11px)] sm:text-[length:var(--app-font-size-ui-sm,11px)] font-normal sm:px-3"
                size="sm"
                type="button"
                onClick={model.leading.planSidebar.onClick}
                title={model.leading.planSidebar.title}
                aria-label={model.leading.planSidebar.title}
              >
                <LayoutSidebarIcon className="size-3.5" />
                <span className="sr-only sm:not-sr-only">{model.leading.planSidebar.label}</span>
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      <div
        data-chat-composer-actions="right"
        className={cn("flex items-center gap-2", model.voiceActive ? "min-w-0 flex-1" : "shrink-0")}
      >
        {!model.voiceActive && model.actions.contextMeter ? (
          <ContextWindowMeter {...model.actions.contextMeter} />
        ) : null}
        {!model.voiceActive ? <ComposerModelControls model={model.actions.modelControls} /> : null}
        {model.voiceActive && model.actions.voiceRecorder ? (
          <ComposerVoiceRecorderBar {...model.actions.voiceRecorder} />
        ) : null}
        <ComposerPrimaryAction action={model.actions.primary} />
      </div>
    </div>
  );
}

export function ChatComposerSection({ model }: { model: ChatComposerSectionModel }) {
  if (!model.frame.visible) {
    return (
      <div
        aria-hidden="true"
        className="w-full overflow-visible"
        data-chat-composer-form="deferred"
      >
        <div
          className={cn(COMPOSER_INPUT_SURFACE_CLASS_NAME, COMPOSER_COLUMN_FRAME_CLASS_NAME)}
          style={{ height: model.deferred.placeholderHeight }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(model.frame.centeredEmptyLanding ? "w-full overflow-visible" : "contents")}
      data-empty-landing-composer-block={model.frame.centeredEmptyLanding ? "true" : undefined}
    >
      <form
        ref={model.frame.form.ref}
        onSubmit={model.frame.form.onSubmit}
        className="relative z-10 w-full overflow-visible"
        data-chat-composer-form="true"
        data-chat-pane-scope={model.frame.form.paneScopeId}
      >
        <ComposerColumnFrame>
          <ComposerStackedActivityRail {...model.activity} />
          <div
            className={cn(
              COMPOSER_INPUT_SHELL_CLASS_NAME,
              model.frame.shell.providerClassName,
              model.frame.shell.menuVisible && "overflow-visible",
            )}
          >
            <div
              className={cn(
                COMPOSER_INPUT_SURFACE_CLASS_NAME,
                model.frame.shell.surfaceClassName,
                model.frame.shell.menuVisible && "overflow-visible",
              )}
            >
              <ComposerInputBanners {...model.editor.banners} />
              <div
                className={cn(
                  COMPOSER_EDITOR_PADDING_CLASS_NAME,
                  model.frame.shell.menuVisible && "overflow-visible",
                )}
              >
                <ComposerMenuOverlay model={model.editor.menu} />
                {model.editor.references ? (
                  <ComposerReferenceAttachments {...model.editor.references} />
                ) : null}
                <ComposerPromptEditor {...model.editor.prompt} />
              </div>
              <ComposerFooter model={model.footer} />
            </div>
          </div>
        </ComposerColumnFrame>
      </form>
      {model.landing.controls}
    </div>
  );
}
