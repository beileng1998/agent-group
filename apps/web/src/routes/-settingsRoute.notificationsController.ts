import type { AppSettings } from "../appSettings";
import { isElectron } from "../env";
import {
  buildNotificationSettingsSupportText,
  readBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
} from "../notifications/taskCompletion";
import { toastManager } from "../components/ui/toast";
import { useEffect, useState } from "react";

type UpdateSettings = (patch: Partial<AppSettings>) => void;

export function useSettingsNotificationsController(input: { updateSettings: UpdateSettings }) {
  const [permission, setPermission] = useState(readBrowserNotificationPermissionState());

  useEffect(() => {
    setPermission(readBrowserNotificationPermissionState());
  }, []);

  async function setEnabled(nextEnabled: boolean) {
    if (!nextEnabled) {
      input.updateSettings({ enableSystemTaskCompletionNotifications: false });
      return;
    }

    if (isElectron) {
      input.updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    const nextPermission = await requestBrowserNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission === "granted") {
      input.updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    input.updateSettings({ enableSystemTaskCompletionNotifications: false });
    toastManager.add({
      type: nextPermission === "denied" ? "warning" : "error",
      title: "Desktop notifications unavailable",
      description: buildNotificationSettingsSupportText(nextPermission),
    });
  }

  async function sendTest() {
    const title = "Activity notification";
    const body = "Notification test for chats and terminal agents.";

    if (window.desktopBridge) {
      const shown = await window.desktopBridge.notifications.show({ title, body, silent: false });
      toastManager.add({
        type: shown ? "success" : "warning",
        title: shown ? "Test notification sent" : "Notifications unavailable",
        description: shown
          ? "Your operating system should show the notification."
          : "Desktop notifications are not supported on this device.",
      });
      return;
    }

    const nextPermission = await requestBrowserNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission !== "granted") {
      toastManager.add({
        type: nextPermission === "denied" ? "warning" : "error",
        title: "Desktop notifications unavailable",
        description: buildNotificationSettingsSupportText(nextPermission),
      });
      return;
    }

    const notification = new Notification(title, {
      body,
      tag: "agent-group:test-notification",
    });
    notification.addEventListener("click", () => window.focus());
    toastManager.add({
      type: "success",
      title: "Test notification sent",
      description: "Your browser should show the notification.",
    });
  }

  return { permission, setEnabled, sendTest };
}
