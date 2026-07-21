import { LuArrowLeft } from "react-icons/lu";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ProviderIcon } from "./SidebarSearchPrimitives";
import { importProviderLabel } from "./sidebarSearchReadModel";
import type { ImportProviderKind, SidebarSearchPaletteMode } from "./sidebarSearchTypes";
import type { SidebarImportController } from "./useSidebarImportController";

interface SidebarSearchImportSurfaceProps {
  controller: SidebarImportController;
  importProviders: readonly ImportProviderKind[];
  onModeChange: (mode: SidebarSearchPaletteMode) => void;
  onOpenChange: (open: boolean) => void;
}

export function SidebarSearchImportSurface(props: SidebarSearchImportSurfaceProps) {
  const { controller } = props;
  return (
    <div className="flex flex-col overflow-hidden">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start gap-3">
          <Button
            size="icon"
            variant="ghost"
            className="-ml-1 mt-[-2px] size-8 shrink-0"
            onClick={() => {
              controller.resetError();
              props.onModeChange("search");
            }}
          >
            <LuArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-medium text-foreground">Import thread from provider</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a local app thread and resume it from an existing provider id.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Provider</p>
          <div className="flex gap-2">
            {props.importProviders.map((provider) => (
              <Button
                key={provider}
                className={
                  controller.provider === provider
                    ? "flex-1 justify-start border-border bg-muted text-foreground hover:bg-muted/80"
                    : "flex-1 justify-start"
                }
                variant="outline"
                onClick={() => controller.setProvider(provider)}
              >
                <ProviderIcon provider={provider} />
                {importProviderLabel(provider)}
              </Button>
            ))}
          </div>
          {props.importProviders.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No connected providers expose chat import in this build.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{controller.fieldLabel}</p>
          <Input
            autoFocus
            nativeInput
            placeholder={controller.placeholder}
            value={controller.id}
            disabled={props.importProviders.length === 0}
            onChange={(event) => controller.setId(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void controller.submit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{controller.description}</p>
        </div>
        {controller.error ? (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {controller.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              controller.resetError();
              props.onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              props.importProviders.length === 0 ||
              controller.id.trim().length === 0 ||
              controller.isImporting
            }
            onClick={controller.submit}
          >
            {controller.isImporting ? "Importing..." : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
