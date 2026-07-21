import type { AppSettings } from "../appSettings";
import { createLatestAppSnapRequestGuard } from "../appSnap.logic";
import { toastManager } from "../components/ui/toast";
import type { DesktopAppSnapState } from "@agent-group/contracts";
import { useEffect, useRef, useState } from "react";

type UpdateSettings = (patch: Partial<AppSettings>) => void;

export function useSettingsAppSnapController(input: {
  active: boolean;
  enabled: boolean;
  updateSettings: UpdateSettings;
}) {
  const [state, setState] = useState<DesktopAppSnapState | null>(null);
  const requestGuardRef = useRef(createLatestAppSnapRequestGuard());

  useEffect(() => {
    if (!input.active) return;
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) {
      setState(null);
      return;
    }
    let disposed = false;
    const unsubscribe = bridge.onState((nextState) => {
      if (!disposed) setState(nextState);
    });
    void bridge
      .getState()
      .then((nextState) => {
        if (!disposed) setState(nextState);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [input.active]);

  async function setEnabled(nextEnabled: boolean) {
    const requestGuard = requestGuardRef.current;
    const requestId = requestGuard.begin();
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) {
      toastManager.add({
        type: "warning",
        title: "AppSnap unavailable",
        description: "AppSnap requires the Agent Group desktop app on macOS.",
      });
      return;
    }

    try {
      if (nextEnabled) {
        const permissionState = await bridge.requestPermissions();
        if (!requestGuard.isCurrent(requestId)) return;
        setState(permissionState);
      }
      if (!requestGuard.isCurrent(requestId)) return;
      input.updateSettings({ enableAppSnap: nextEnabled });
      const nextState = await bridge.setEnabled(nextEnabled);
      if (!requestGuard.isCurrent(requestId)) return;
      setState(nextState);
      if (
        nextEnabled &&
        (nextState.status === "permission-required" || nextState.status === "error")
      ) {
        toastManager.add({
          type: "warning",
          title: "Finish AppSnap setup",
          description: nextState.message ?? "Allow the required macOS permissions, then try again.",
        });
      }
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      input.updateSettings({ enableAppSnap: false });
      toastManager.add({
        type: "error",
        title: "AppSnap setup failed",
        description: error instanceof Error ? error.message : "Could not configure AppSnap.",
      });
    }
  }

  async function recheckPermissions() {
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    const requestGuard = requestGuardRef.current;
    const requestId = requestGuard.begin();
    try {
      await bridge.requestPermissions();
      const nextState = await bridge.setEnabled(input.enabled);
      if (!requestGuard.isCurrent(requestId)) return;
      setState(nextState);
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      toastManager.add({
        type: "error",
        title: "Could not check AppSnap permissions",
        description: error instanceof Error ? error.message : "Permission check failed.",
      });
    }
  }

  return { state, setEnabled, recheckPermissions };
}
