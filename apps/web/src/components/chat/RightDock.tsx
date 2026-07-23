// FILE: RightDock.tsx
// Purpose: Adaptive tabbed dock shell (browser, diff, terminal, sidechat, git).
// Layer: Chat right-dock UI
// Depends on: right-dock pane metadata and a caller-provided pane renderer.

import * as Schema from "effect/Schema";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import {
  DISCLOSURE_MOTION_SUPPRESSED_CLASS,
  DISCLOSURE_SLIDE_MOTION_CLASS,
} from "~/lib/disclosureMotion";
import {
  type DockPaneRuntimeMode,
  EMPTY_PANE_ID_SET,
  reconcileKeepMountedPaneIds,
} from "~/lib/dockPaneActivation";
import { ChevronDownIcon, PanelRightCloseIcon, PlusIcon } from "~/lib/icons";
import { createPanelResizeOverlay, removePanelResizeOverlay } from "~/lib/panelResize";
import type {
  RightDockPane,
  RightDockPaneKind,
  RightDockThreadState,
} from "~/rightDockStore.logic";
import { resolveActivePane } from "~/rightDockStore.logic";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { SidebarProvider } from "../ui/sidebar";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
  DOCK_HEADER_ICON_BUTTON_CLASS,
  SurfaceTabChip,
} from "./chatHeaderControls";
import {
  getRightDockPaneMeta,
  resolveRightDockPaneIcon,
  resolveRightDockPaneLabel,
} from "./rightDockPaneMeta";
import { RightDockPlacementMenu } from "./RightDockPlacementMenu";
import {
  clampBottomDockHeight,
  defaultBottomDockHeight,
  resolveRightDockPlacement,
  RIGHT_DOCK_PLACEMENT_STORAGE_KEY,
  type RightDockPlacementPreference,
} from "./rightDockPlacement";

// Shared sizing defaults for dock hosts: the resize floor for a single readable pane and the
// "half the shell, but never cramped" opening width. The thread route tunes its own values
// around the composer; simpler hosts (e.g. the /pull-requests route) use these as-is.
export const RIGHT_DOCK_MIN_WIDTH = 26 * 16;
export const RIGHT_DOCK_DEFAULT_WIDTH = "max(28rem, calc(50vw - 8rem))";

interface RightDockProps {
  state: RightDockThreadState;
  minWidth: number;
  defaultWidth: string;
  shouldAcceptWidth: (context: { nextWidth: number; wrapper: HTMLElement }) => boolean;
  paneLabelOverrides?: Record<string, string | undefined>;
  // Per-pane tab glyph overrides (same shape as label overrides) — e.g. a pull request pane
  // swapping the generic kind icon for its live state glyph.
  paneIconOverrides?: Record<string, ReactNode | undefined>;
  addMenuKinds: readonly RightDockPaneKind[];
  // Single-pane hosts omit selection so their lone tab label is static; multi-pane chat hosts
  // provide the callback and keep the normal selectable-tab behavior.
  onSelectPane?: ((paneId: string) => void) | undefined;
  onClosePane: (paneId: string) => void;
  onCollapse: () => void;
  onAddPane: (kind: RightDockPaneKind) => void;
  motionKey?: string;
  activePaneRuntimeMode?: DockPaneRuntimeMode;
  renderPane: (
    pane: RightDockPane,
    context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean; isVisible: boolean },
  ) => ReactNode;
}

function RightDockTab(props: {
  pane: RightDockPane;
  label: string;
  icon?: ReactNode;
  active: boolean;
  onSelect?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  return (
    <SurfaceTabChip
      active={props.active}
      title={props.label}
      label={props.label}
      labelClassName="max-w-[10rem]"
      icon={props.icon ?? resolveRightDockPaneIcon(props.pane)}
      closeLabel={`Close ${props.label}`}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  );
}

// Persist which keep-mounted panes (e.g. terminals) have been activated so they
// stay in the DOM while another tab is selected, pruned to live panes so closed
// panes drop out and the set never leaks across thread switches. The set is
// reconciled during render on purpose: when a kept pane stops being active it
// must remain in the rendered list on that same render, otherwise it would
// unmount for a frame and lose the very runtime keep-mount is protecting.
function useKeepMountedPaneIds(
  panes: readonly RightDockPane[],
  activePane: RightDockPane | null,
): ReadonlySet<string> {
  const ref = useRef<ReadonlySet<string>>(EMPTY_PANE_ID_SET);
  ref.current = reconcileKeepMountedPaneIds({
    previous: ref.current,
    panes,
    activePaneId: activePane?.id ?? null,
    activePaneKind: activePane?.kind ?? null,
  });
  return ref.current;
}

const RIGHT_DOCK_PLACEMENT_SCHEMA = Schema.Union([
  Schema.Literal("auto"),
  Schema.Literal("right"),
  Schema.Literal("bottom"),
]);
const DEFAULT_RIGHT_DOCK_PLACEMENT: RightDockPlacementPreference = "auto";

export function RightDock(props: RightDockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const activePane = resolveActivePane(props.state);
  const activePaneRuntimeMode = props.activePaneRuntimeMode ?? "live";
  const keepMountedPaneIds = useKeepMountedPaneIds(props.state.panes, activePane);
  const [placementPreference, setPlacementPreference] = useLocalStorage(
    RIGHT_DOCK_PLACEMENT_STORAGE_KEY,
    DEFAULT_RIGHT_DOCK_PLACEMENT,
    RIGHT_DOCK_PLACEMENT_SCHEMA,
  );
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const resolvedPlacement = resolveRightDockPlacement({
    preference: placementPreference,
    hostWidth: hostSize.width,
    hostHeight: hostSize.height,
  });
  const automaticPlacement = resolveRightDockPlacement({
    preference: "auto",
    hostWidth: hostSize.width,
    hostHeight: hostSize.height,
  });
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  useLayoutEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setHostSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const previousGeometryRef = useRef({ open: false, placement: resolvedPlacement });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || hostSize.width <= 0 || hostSize.height <= 0) return;
    const previous = previousGeometryRef.current;
    const shouldCenter =
      props.state.open && (!previous.open || previous.placement !== resolvedPlacement);

    if (props.state.open && resolvedPlacement === "right") {
      const currentWidth = root.getBoundingClientRect().width;
      const nextWidth = shouldCenter
        ? Math.min(hostSize.width, Math.max(props.minWidth, Math.round(hostSize.width / 2)))
        : Math.min(hostSize.width, Math.max(props.minWidth, currentWidth));
      root.style.setProperty("--sidebar-width", `${nextWidth}px`);
    } else if (props.state.open) {
      const currentHeight = root.getBoundingClientRect().height;
      const nextHeight = shouldCenter
        ? defaultBottomDockHeight(hostSize.height)
        : clampBottomDockHeight(currentHeight, hostSize.height);
      root.style.setProperty("--right-dock-height", `${nextHeight}px`);
    }
    previousGeometryRef.current = { open: props.state.open, placement: resolvedPlacement };
  }, [hostSize, props.minWidth, props.state.open, resolvedPlacement]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const root = rootRef.current;
      const host = root?.parentElement;
      if (!root || !host || !props.state.open || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const hostRect = host.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const cursor = resolvedPlacement === "right" ? "col-resize" : "row-resize";
      const overlay = createPanelResizeOverlay(cursor);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (resolvedPlacement === "right") {
          const requestedWidth = rootRect.width + startX - moveEvent.clientX;
          const nextWidth = Math.min(hostRect.width, Math.max(props.minWidth, requestedWidth));
          if (props.shouldAcceptWidth({ nextWidth, wrapper: root })) {
            root.style.setProperty("--sidebar-width", `${nextWidth}px`);
          }
          return;
        }
        const requestedHeight = rootRect.height + startY - moveEvent.clientY;
        const nextHeight = clampBottomDockHeight(requestedHeight, hostRect.height);
        root.style.setProperty("--right-dock-height", `${nextHeight}px`);
      };

      const finishResize = () => {
        removePanelResizeOverlay(overlay);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        overlay.removeEventListener("pointermove", onPointerMove);
        overlay.removeEventListener("pointerup", finishResize);
        overlay.removeEventListener("pointercancel", finishResize);
        resizeCleanupRef.current = null;
      };

      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
      overlay.addEventListener("pointermove", onPointerMove);
      overlay.addEventListener("pointerup", finishResize);
      overlay.addEventListener("pointercancel", finishResize);
      resizeCleanupRef.current = finishResize;
    },
    [props.minWidth, props.shouldAcceptWidth, props.state.open, resolvedPlacement],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const renderedPanes = props.state.panes.filter(
    (pane) => pane.id === activePane?.id || keepMountedPaneIds.has(pane.id),
  );
  const layoutMotionKey = `${props.motionKey ?? ""}:${resolvedPlacement}`;
  const [allowChromeMotion, setAllowChromeMotion] = useState(() => !props.state.open);
  const [, forceMotionClassRefresh] = useState(0);
  const previousMotionKeyRef = useRef(layoutMotionKey);
  const motionKeyChanged = previousMotionKeyRef.current !== layoutMotionKey;
  const shouldSuppressChromeMotion = !allowChromeMotion || motionKeyChanged;

  useEffect(() => {
    const hadMotionKeyChange = previousMotionKeyRef.current !== layoutMotionKey;
    previousMotionKeyRef.current = layoutMotionKey;
    if (!shouldSuppressChromeMotion) return;
    if (!allowChromeMotion) setAllowChromeMotion(true);
    if (hadMotionKeyChange && allowChromeMotion) {
      forceMotionClassRefresh((version) => version + 1);
    }
  }, [allowChromeMotion, layoutMotionKey, shouldSuppressChromeMotion]);

  const chromeMotionClass = shouldSuppressChromeMotion
    ? DISCLOSURE_MOTION_SUPPRESSED_CLASS
    : undefined;
  const isRight = resolvedPlacement === "right";

  return (
    <div
      ref={rootRef}
      data-dock-placement={resolvedPlacement}
      data-right-dock-root
      data-slot="sidebar-wrapper"
      data-state={props.state.open ? "expanded" : "collapsed"}
      className={cn(
        "group/right-dock relative z-0 min-h-0 min-w-0 flex-none overflow-hidden bg-transparent transition-[width,height]",
        DISCLOSURE_SLIDE_MOTION_CLASS,
        isRight ? "h-full" : "w-full",
        chromeMotionClass,
      )}
      style={
        {
          "--sidebar-width": props.defaultWidth,
          "--right-dock-height": "50%",
          width: isRight ? (props.state.open ? "var(--sidebar-width)" : "0px") : "100%",
          height: isRight ? "100%" : props.state.open ? "var(--right-dock-height)" : "0px",
        } as CSSProperties
      }
    >
      <SidebarProvider defaultOpen={false} open={props.state.open} className="contents">
        <div
          aria-hidden={props.state.open ? undefined : true}
          inert={props.state.open ? undefined : true}
          className={cn(
            "absolute flex min-h-0 min-w-0 flex-col border-[var(--app-surface-divider)] text-foreground",
            CHAT_BACKGROUND_CLASS_NAME,
            isRight
              ? "inset-y-0 right-0 w-(--sidebar-width) border-l"
              : "inset-x-0 bottom-0 h-(--right-dock-height) border-t",
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={isRight ? "Resize right panel" : "Resize bottom panel"}
            title={isRight ? "Drag to resize right panel" : "Drag to resize bottom panel"}
            className={cn(
              "absolute z-20 bg-transparent after:absolute after:bg-transparent after:transition-colors hover:after:bg-sidebar-border",
              isRight
                ? "inset-y-0 left-0 w-3 cursor-col-resize after:inset-y-0 after:left-0 after:w-[2px]"
                : "inset-x-0 top-0 h-3 cursor-row-resize after:inset-x-0 after:top-0 after:h-[2px]",
            )}
            onPointerDown={startResize}
          />
          <div data-right-dock-content className="flex h-full min-h-0 w-full flex-col">
            <div
              className={cn(
                CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
                "gap-1 px-1.5",
                isRight ? desktopTopBarWindowControlsGutterClassName : undefined,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {props.state.panes.map((pane) => (
                  <RightDockTab
                    key={pane.id}
                    pane={pane}
                    label={resolveRightDockPaneLabel(pane, props.paneLabelOverrides)}
                    icon={props.paneIconOverrides?.[pane.id]}
                    active={pane.id === props.state.activePaneId}
                    onSelect={props.onSelectPane ? () => props.onSelectPane?.(pane.id) : undefined}
                    onClose={pane.kind === "context" ? undefined : () => props.onClosePane(pane.id)}
                  />
                ))}
              </div>
              {props.addMenuKinds.length > 0 ? (
                <Menu modal={false}>
                  <MenuTrigger
                    render={
                      <Button
                        variant="chrome"
                        size="icon-xs"
                        aria-label="Add panel"
                        title="Add panel"
                        className={DOCK_HEADER_ICON_BUTTON_CLASS}
                      />
                    }
                  >
                    <PlusIcon className="size-3.5" />
                  </MenuTrigger>
                  <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
                    {props.addMenuKinds.map((kind) => {
                      const { Icon, label } = getRightDockPaneMeta(kind);
                      return (
                        <MenuItem key={kind} onClick={() => props.onAddPane(kind)}>
                          <Icon className="size-3.5 shrink-0" />
                          <span>{label}</span>
                        </MenuItem>
                      );
                    })}
                  </ComposerPickerMenuPopup>
                </Menu>
              ) : null}
              <RightDockPlacementMenu
                preference={placementPreference}
                resolvedPlacement={resolvedPlacement}
                automaticPlacement={automaticPlacement}
                onChange={setPlacementPreference}
              />
              <IconButton
                variant="chrome"
                size="icon-xs"
                label="Collapse panel"
                tooltip="Collapse panel"
                tooltipSide="bottom"
                className={DOCK_HEADER_ICON_BUTTON_CLASS}
                onClick={props.onCollapse}
              >
                {isRight ? <PanelRightCloseIcon /> : <ChevronDownIcon />}
              </IconButton>
            </div>
            <div className="relative min-h-0 flex-1">
              {renderedPanes.map((pane) => {
                const isActive = pane.id === activePane?.id;
                const isVisible = isActive && props.state.open;
                const runtimeMode: DockPaneRuntimeMode = isActive ? activePaneRuntimeMode : "live";
                return (
                  <div
                    key={pane.id}
                    className={cn(
                      "absolute inset-0 flex min-h-0 w-full flex-col",
                      isActive ? undefined : "invisible pointer-events-none",
                    )}
                    aria-hidden={isVisible ? undefined : true}
                    inert={isVisible ? undefined : true}
                    data-native-browser-surface={
                      pane.kind === "browser" && isActive && runtimeMode === "live"
                        ? "true"
                        : undefined
                    }
                  >
                    {props.renderPane(pane, { runtimeMode, isActive, isVisible })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}

export default RightDock;
