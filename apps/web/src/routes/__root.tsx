import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { type QueryClient } from "@tanstack/react-query";

import { AGENT_GROUP_CAPABILITIES } from "../agentGroupCapabilities";
import { APP_DISPLAY_NAME } from "../branding";
import { AppSnapCoordinator } from "../components/AppSnapCoordinator";
import { AppSnapWelcomeDialog } from "../components/AppSnapWelcomeDialog";
import { DesktopWindowControls } from "../components/DesktopWindowControls";
import { AnchoredToastProvider, ToastProvider } from "../components/ui/toast";
import { useGitProgressToastPreview } from "../components/useGitProgressToastPreview";
import { useFeatureFlags } from "../featureFlags";
import { useAppDensity } from "../hooks/useAppDensity";
import { useAppTypography } from "../hooks/useAppTypography";
import { useNativeFontSmoothing } from "../hooks/useNativeFontSmoothing";
import { usePreloadSettingsRoute } from "../hooks/usePreloadSettingsRoute";
import { useSyncDesktopTopBarTrafficLightGutterZoom } from "../hooks/useDesktopTopBarGutter";
import { useTheme } from "../hooks/useTheme";
import { DISCLOSURE_ROOT_CSS } from "../lib/disclosureMotion";
import { readNativeApi } from "../nativeApi";
import { TaskCompletionNotifications } from "../notifications/taskCompletion";
import { DesktopProjectBootstrap } from "./-rootDesktopProjectBootstrap";
import { EventRouter } from "./-rootEventRouter";
import {
  GlobalShortcutsDialog,
  GlobalWhatsNewSurface,
  RootRouteErrorView,
} from "./-rootGlobalSurfaces";
import {
  ProviderStatusRefreshCoordinator,
  ProviderUpdateNotifications,
} from "./-rootProviderUpdates";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  useAppTypography();
  useAppDensity();
  usePreloadSettingsRoute();
  useNativeFontSmoothing();
  useSyncDesktopTopBarTrafficLightGutterZoom();
  useTheme();

  // Single mount point for the Windows caption buttons. The cluster is pinned to the
  // window's top-right corner (frameless Windows shell) and renders nothing on macOS,
  // Linux, or the web build, so it is safe to mount unconditionally here — including on
  // the pre-backend "connecting" screen, so the window stays closable before the
  // renderer connects. Top bars reserve space for it via
  // useDesktopTopBarWindowControlsGutterClassName().
  //
  // MUST render LAST: Electron builds the OS drag region by walking elements with
  // `-webkit-app-region` in DOM order, unioning `drag` rects and subtracting `no-drag`
  // rects in sequence. The route headers are full-width `drag-region`s that extend under
  // this cluster, so the cluster's `no-drag` rect has to be subtracted AFTER those drag
  // rects are added — otherwise the OS reclaims the corner as title-bar caption and
  // swallows the click as a window drag (the buttons render but do nothing). Rendering
  // it last in document order guarantees that subtraction wins. (z above dialogs/toasts
  // so it also stays clickable while a modal is open.)
  const desktopWindowControls = <DesktopWindowControls className="fixed top-0 right-0 z-[250]" />;

  if (!readNativeApi()) {
    return (
      <>
        <style>{DISCLOSURE_ROOT_CSS}</style>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Connecting to {APP_DISPLAY_NAME} server...
            </p>
          </div>
        </div>
        {desktopWindowControls}
      </>
    );
  }

  return (
    <>
      <style>{DISCLOSURE_ROOT_CSS}</style>
      <ToastProvider position="top-center">
        <AnchoredToastProvider>
          <GitProgressToastPreviewDev />
          <EventRouter />
          <ProviderStatusRefreshCoordinator />
          <GlobalShortcutsDialog />
          {AGENT_GROUP_CAPABILITIES.upstreamWhatsNew ? <GlobalWhatsNewSurface /> : null}
          <TaskCompletionNotifications />
          <AppSnapWelcomeDialog />
          <AppSnapCoordinator />
          <ProviderUpdateNotifications />
          <DesktopProjectBootstrap />
          <Outlet />
        </AnchoredToastProvider>
      </ToastProvider>
      {desktopWindowControls}
    </>
  );
}

function GitProgressToastPreviewDev() {
  const featureFlags = useFeatureFlags();
  const enabled = import.meta.env.DEV && featureFlags["pin-git-progress-toast-preview"];
  useGitProgressToastPreview(enabled);
  return null;
}
