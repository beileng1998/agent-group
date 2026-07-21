// FILE: PluginLibrary.tsx
// Purpose: Hosts the plugin and skill browser surfaced from provider discovery APIs.
// Layer: Route-level screen
// Exports: PluginLibrary

import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";
import { PluginLibraryContent } from "./plugin-library/PluginLibraryContent";
import { PluginLibraryTabs, ProviderDiscoveryToggle } from "./plugin-library/PluginLibraryControls";
import { usePluginLibraryCatalog } from "./plugin-library/usePluginLibraryCatalog";
import { SidebarHeaderNavigationControls } from "./SidebarHeaderNavigationControls";
import { SidebarInset } from "./ui/sidebar";

export function PluginLibrary() {
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const catalog = usePluginLibraryCatalog();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full flex-col">
        <div
          className={cn(
            "drag-region flex shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6",
            desktopTopBarTrafficLightGutterClassName,
            desktopTopBarWindowControlsGutterClassName,
          )}
        >
          <SidebarHeaderNavigationControls />
          <PluginLibraryTabs
            selectedTab={catalog.selectedTab}
            onSelectTab={catalog.setSelectedTab}
          />
          <div className="flex-1" />
          <ProviderDiscoveryToggle
            selectedProvider={catalog.selectedProvider}
            providerCapabilities={catalog.providerCapabilities}
            onSelectProvider={catalog.selectProvider}
          />
        </div>
        <PluginLibraryContent catalog={catalog} />
      </div>
    </SidebarInset>
  );
}
