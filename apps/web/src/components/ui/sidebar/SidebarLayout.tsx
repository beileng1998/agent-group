import * as React from "react";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { CentralIcon } from "~/lib/central-icons";
import { DISCLOSURE_SLIDE_MOTION_CLASS } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import {
  resolveSidebarResizable,
  SIDEBAR_WIDTH_MOBILE,
  SidebarInstanceContext,
  type SidebarInstanceContextProps,
  type SidebarResizableOptions,
  useSidebar,
} from "./sidebarContext";

export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  resizable = false,
  className,
  gapClassName,
  innerClassName,
  transparentSurface = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  resizable?: boolean | SidebarResizableOptions;
  gapClassName?: string;
  innerClassName?: string;
  transparentSurface?: boolean;
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  const resolvedResizable = React.useMemo(
    () => resolveSidebarResizable(resizable, { collapsible, isMobile }),
    [collapsible, isMobile, resizable],
  );
  const instanceContextValue = React.useMemo<SidebarInstanceContextProps>(
    () => ({ side, resizable: resolvedResizable }),
    [resolvedResizable, side],
  );

  if (collapsible === "none") {
    return (
      <SidebarInstanceContext.Provider value={instanceContextValue}>
        <div
          className={cn(
            "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
            innerClassName,
            className,
          )}
          data-slot="sidebar"
          {...props}
        >
          {children}
        </div>
      </SidebarInstanceContext.Provider>
    );
  }

  if (isMobile) {
    return (
      <SidebarInstanceContext.Provider value={instanceContextValue}>
        <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
          <SheetPopup
            className={cn(
              "w-(--sidebar-width) max-w-none bg-sidebar p-0 text-sidebar-foreground",
              className,
            )}
            data-mobile="true"
            data-sidebar="sidebar"
            data-slot="sidebar"
            showCloseButton={false}
            side={side}
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Sidebar</SheetTitle>
              <SheetDescription>Displays the mobile sidebar.</SheetDescription>
            </SheetHeader>
            <div className={cn("flex h-full w-full flex-col", innerClassName)}>{children}</div>
          </SheetPopup>
        </Sheet>
      </SidebarInstanceContext.Provider>
    );
  }

  return (
    <SidebarInstanceContext.Provider value={instanceContextValue}>
      <div
        className="group peer hidden text-sidebar-foreground md:block"
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-side={side}
        data-slot="sidebar"
        data-state={state}
        data-variant={variant}
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          className={cn(
            "relative w-(--sidebar-width) bg-transparent transition-[width]",
            DISCLOSURE_SLIDE_MOTION_CLASS,
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
            gapClassName,
          )}
          data-slot="sidebar-gap"
        />
        <div
          className={cn(
            "fixed inset-y-0 z-0 hidden h-svh w-(--sidebar-width) transition-[left,right,width] md:flex",
            DISCLOSURE_SLIDE_MOTION_CLASS,
            side === "left"
              ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
              : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
            // Adjust the padding for floating and inset variants.
            variant === "floating" || variant === "inset"
              ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
              : cn(
                  "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
                  // Skip container border when innerClassName provides its own
                  !transparentSurface &&
                    "group-data-[side=left]:border-r group-data-[side=right]:border-l",
                ),
            className,
          )}
          data-slot="sidebar-container"
          {...props}
        >
          {/* The inner surface is the safe place for visual skinning. The outer shell owns
              fixed positioning, width transitions, and the resize rail hit area. */}
          <div
            className={cn(
              "relative z-0 flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm/5",
              !transparentSurface && "bg-sidebar",
              innerClassName,
            )}
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
          >
            {children}
          </div>
        </div>
      </div>
    </SidebarInstanceContext.Provider>
  );
}

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("size-7", className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon-xs"
      variant="ghost"
      {...props}
    >
      <CentralIcon name="sidebar-hidden-left-wide" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

// Desktop headers lose access to the in-sidebar trigger after an off-canvas close,
// so this companion control reuses the same trigger and only appears when hidden.
// Traffic-light clearance is owned solely by the host header's
// DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS gutter — this control adds no offset of
// its own, so the toggle sits at the same x whether the sidebar is open or closed.
export function SidebarHeaderTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { isMobile, open } = useSidebar();

  if (!isMobile && open) {
    return null;
  }

  return <SidebarTrigger className={className} onClick={onClick} {...props} />;
}

export function SidebarInset({
  className,
  children,
  surfaceClassName,
  ...props
}: React.ComponentProps<"main"> & {
  surfaceClassName?: string;
}) {
  return (
    <main
      className={cn(
        // Keep caller layout classes on the outer shell so route-level height and
        // overflow constraints still apply after the inner-surface refactor.
        "relative flex min-h-0 min-w-0 w-full flex-1 flex-col bg-transparent",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:-ms-[var(--sidebar-width)]",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:w-[calc(100%+var(--sidebar-width))]",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:ps-[var(--sidebar-width)]",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    >
      {/* Inner surface lives inside the content-box so rounded corners
          and bg are visible even when padding offsets the sidebar area. */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col text-inherit",
          surfaceClassName ?? "bg-background",
        )}
        data-slot="sidebar-inset-surface"
      >
        {children}
      </div>
    </main>
  );
}
