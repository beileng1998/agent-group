// FILE: useSidebarDebugFeatureFlagsOwner.ts
// Purpose: Own debug feature-flag visibility, storage synchronization, and console commands.
// Layer: Web sidebar development owner

import { useEffect, useState } from "react";
import {
  DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY,
  shouldShowDebugFeatureFlagsMenu,
} from "../components/Sidebar.logic";

type DebugFeatureFlagsWindow = Window & {
  agentGroupShowFeatureFlags?: () => void;
  agentGroupHideFeatureFlags?: () => void;
};

function readDebugFeatureFlagsMenuVisibility(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return shouldShowDebugFeatureFlagsMenu({
      isDev: import.meta.env.DEV,
      hostname: window.location.hostname,
      storageValue: window.localStorage.getItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY),
    });
  } catch {
    return false;
  }
}

export function useSidebarDebugFeatureFlagsOwner() {
  const [showDebugFeatureFlagsMenu, setShowDebugFeatureFlagsMenu] = useState(
    readDebugFeatureFlagsMenuVisibility,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const canInstallConsoleCommand = shouldShowDebugFeatureFlagsMenu({
      isDev: import.meta.env.DEV,
      hostname: window.location.hostname,
      storageValue: "true",
    });
    if (!canInstallConsoleCommand) {
      return;
    }

    const debugWindow = window as DebugFeatureFlagsWindow;
    const updateVisibility = () => {
      setShowDebugFeatureFlagsMenu(readDebugFeatureFlagsMenuVisibility());
    };
    const showFeatureFlags = () => {
      window.localStorage.setItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY, "true");
      updateVisibility();
    };
    const hideFeatureFlags = () => {
      window.localStorage.removeItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY);
      updateVisibility();
    };

    debugWindow.agentGroupShowFeatureFlags = showFeatureFlags;
    debugWindow.agentGroupHideFeatureFlags = hideFeatureFlags;
    window.addEventListener("storage", updateVisibility);
    updateVisibility();

    return () => {
      window.removeEventListener("storage", updateVisibility);
      if (debugWindow.agentGroupShowFeatureFlags === showFeatureFlags) {
        delete debugWindow.agentGroupShowFeatureFlags;
      }
      if (debugWindow.agentGroupHideFeatureFlags === hideFeatureFlags) {
        delete debugWindow.agentGroupHideFeatureFlags;
      }
    };
  }, []);

  return {
    showDebugFeatureFlagsMenu,
  };
}

export type SidebarDebugFeatureFlagsOwner = ReturnType<typeof useSidebarDebugFeatureFlagsOwner>;
