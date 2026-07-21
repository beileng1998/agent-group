import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Button } from "~/components/ui/button";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

import { AutomationDialog } from "../-automations.shared";
import { AutomationDetailSidebar } from "./AutomationDetailSidebar";
import {
  type LoadedAutomationDetailController,
  useAutomationDetailController,
} from "./useAutomationDetailController";

export function AutomationDetailPage({ automationId }: { readonly automationId: string }) {
  const controller = useAutomationDetailController(automationId);

  if (controller.kind === "missing") {
    return <AutomationMissingPage onBack={controller.navigateToAutomations} />;
  }

  return <LoadedAutomationDetailPage controller={controller} />;
}

function AutomationMissingPage({ onBack }: { readonly onBack: () => void }) {
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  return (
    <RouteInsetSurface>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        <header
          className={cn(
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
            "drag-region",
            desktopTopBarTrafficLightGutterClassName,
            desktopTopBarWindowControlsGutterClassName,
          )}
        >
          <div className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
            <SidebarHeaderNavigationControls />
            <h1 className="truncate font-heading text-sm font-medium">Automations</h1>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          Automation not found.
          <Button type="button" size="sm" variant="outline" onClick={onBack}>
            Back to automations
          </Button>
        </main>
      </div>
    </RouteInsetSurface>
  );
}

function LoadedAutomationDetailPage({
  controller,
}: {
  readonly controller: LoadedAutomationDetailController;
}) {
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();

  const { definition, dialog, projects, threads } = controller;
  return (
    <RouteInsetSurface>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
            )}
          >
            <div
              className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}
            >
              <SidebarHeaderNavigationControls />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm [-webkit-app-region:no-drag]">
                <button
                  type="button"
                  onClick={controller.navigateToAutomations}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Automations
                </button>
                <CentralIcon
                  name="chevron-right-small"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate font-heading font-medium">{definition.name}</span>
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-8">
            <div className="max-w-3xl space-y-4">
              <h1 className="font-heading text-2xl font-normal text-foreground">
                {definition.name}
              </h1>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-muted-foreground">
                {definition.prompt}
              </p>
            </div>
          </main>
        </div>

        <AutomationDetailSidebar controller={controller} />
      </div>

      {dialog.form ? (
        <AutomationDialog
          open={dialog.open}
          editing
          form={dialog.form}
          projects={projects}
          threads={threads}
          warnings={dialog.warnings}
          acknowledgedWarningIds={dialog.acknowledgedWarningIds}
          onToggleWarning={dialog.toggleWarning}
          onOpenChange={dialog.setOpen}
          onFormChange={dialog.updateForm}
          onSubmit={dialog.submit}
          busy={controller.updatePending}
        />
      ) : null}
    </RouteInsetSurface>
  );
}
