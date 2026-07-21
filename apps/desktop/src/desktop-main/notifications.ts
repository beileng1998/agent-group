import { app, Notification } from "electron";
import { MENU_ACTION_CHANNEL } from "./constants";
import { desktopState } from "./state";
import { resolveNotificationIconPath } from "./appIdentity";

export function syncUnreadNotificationBadge(): void {
  app.setBadgeCount(desktopState.unreadBackgroundNotificationCount);
}

export function isMainWindowForeground(): boolean {
  const window = desktopState.mainWindow;
  return Boolean(
    window &&
    !window.isDestroyed() &&
    window.isVisible() &&
    !window.isMinimized() &&
    window.isFocused(),
  );
}

export function clearUnreadNotificationBadge(): void {
  if (desktopState.unreadBackgroundNotificationCount === 0) return;
  desktopState.unreadBackgroundNotificationCount = 0;
  syncUnreadNotificationBadge();
}

export function focusMainWindow(options: { stealAppFocus?: boolean } = {}): void {
  const window = desktopState.mainWindow;
  if (!window || window.isDestroyed()) {
    desktopState.mainWindow = null;
    return;
  }
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  if (process.platform === "darwin" && options.stealAppFocus === true) {
    app.show();
    app.focus({ steal: true });
  }
  window.focus();
}

export function showDesktopNotification(input: {
  title: string;
  body?: string;
  silent?: boolean;
  threadId?: string;
}): boolean {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const threadId = typeof input.threadId === "string" ? input.threadId.trim() : "";
  if (!title || !Notification.isSupported()) return false;
  const iconPath = resolveNotificationIconPath();
  const notification = new Notification({
    title,
    body,
    silent: input.silent === true,
    ...(iconPath ? { icon: iconPath } : {}),
  });
  if (!isMainWindowForeground()) {
    desktopState.unreadBackgroundNotificationCount = Math.min(
      desktopState.unreadBackgroundNotificationCount + 1,
      99,
    );
    syncUnreadNotificationBadge();
  }
  notification.on("click", () => {
    clearUnreadNotificationBadge();
    focusMainWindow();
    const window = desktopState.mainWindow;
    if (window && threadId) {
      window.webContents.send(MENU_ACTION_CHANNEL, `notification-open-thread:${threadId}`);
    }
  });
  notification.show();
  return true;
}
