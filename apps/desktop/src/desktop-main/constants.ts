import * as Crypto from "node:crypto";
import * as OS from "node:os";
import * as Path from "node:path";

import { AGENT_GROUP_DESKTOP_SCHEME, agentGroupBundleId } from "@agent-group/shared/desktopIdentity";

export const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
export const SAVE_FILE_CHANNEL = "desktop:save-file";
export const CONFIRM_CHANNEL = "desktop:confirm";
export const SET_THEME_CHANNEL = "desktop:set-theme";
export const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
export const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
export const SHOW_IN_FOLDER_CHANNEL = "desktop:show-in-folder";
export const CLIPBOARD_WRITE_IMAGE_CHANNEL = "desktop:clipboard-write-image";
export const MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH = 16 * 1024 * 1024;
export const WINDOW_MINIMIZE_CHANNEL = "desktop:window-minimize";
export const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "desktop:window-toggle-maximize";
export const WINDOW_CLOSE_CHANNEL = "desktop:window-close";
export const WINDOW_GET_STATE_CHANNEL = "desktop:window-get-state";
export const WINDOW_STATE_CHANNEL = "desktop:window-state";
export const MENU_ACTION_CHANNEL = "desktop:menu-action";
export const ZOOM_FACTOR_CHANNEL = "desktop:zoom-factor";
export const ZOOM_FACTOR_CHANGED_CHANNEL = "desktop:zoom-factor-changed";
export const AUTH_REQUEST_CHANNEL = "desktop:auth-request";
export const UPDATE_STATE_CHANNEL = "desktop:update-state";
export const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
export const UPDATE_CHECK_CHANNEL = "desktop:update-check";
export const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
export const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
export const NOTIFICATIONS_IS_SUPPORTED_CHANNEL = "desktop:notifications-is-supported";
export const NOTIFICATIONS_SHOW_CHANNEL = "desktop:notifications-show";

export const BASE_DIR =
  process.env.AGENT_GROUP_HOME?.trim() ||
  Path.join(OS.homedir(), ".agent-group");
export const STATE_DIR = Path.join(BASE_DIR, "userdata");
export const DESKTOP_WINDOW_STATE_PATH = Path.join(STATE_DIR, "desktop-window-state.json");
export const DESKTOP_SCHEME = AGENT_GROUP_DESKTOP_SCHEME;
export const ROOT_DIR = Path.resolve(__dirname, "../../..");
export const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
export const APP_DISPLAY_NAME = isDevelopment ? "Agent Group (Dev)" : "Agent Group";
export const APP_USER_MODEL_ID = agentGroupBundleId(isDevelopment);
export const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
export const COMMIT_HASH_DISPLAY_LENGTH = 12;
export const LOG_DIR = Path.join(STATE_DIR, "logs");
export const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_FILE_MAX_FILES = 10;
export const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");

export const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
export const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS = 30 * 1000;
export const AUTO_UPDATE_CHECK_TIMEOUT_MS = 45 * 1000;
export const AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000;
export const AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS = 20 * 1000;
export const AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS = 2 * 60 * 1000;
export const AUTO_UPDATE_INSTALL_WATCHDOG_MS = 15 * 1000;
export const AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS = 2_800;
export const UPDATE_INSTALL_MARKER_FILE_NAME = "pending-update-install.json";
export const BACKEND_FORCE_KILL_DELAY_MS = 8_000;
export const BACKEND_SHUTDOWN_TIMEOUT_MS = 10_000;
export const BACKEND_MAX_OLD_SPACE_ENV_KEYS = ["AGENT_GROUP_BACKEND_MAX_OLD_SPACE_MB"] as const;
export const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
export const BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
export const DESKTOP_MENU_ZOOM_FACTOR_STEP = 1.1;
export const DESKTOP_MENU_MIN_ZOOM_FACTOR = 0.25;
export const DESKTOP_MENU_MAX_ZOOM_FACTOR = 5;
export const AGENT_GROUP_BROWSER_LABEL = "Agent Group browser";
export const browserPerfLoggingEnabled = process.env.AGENT_GROUP_BROWSER_PERF === "1";
export const BUNDLE_SWAP_POLL_INTERVAL_MS = 15_000;

export const DESKTOP_AUTH_PATHS = new Set([
  "/api/auth/session",
  "/api/auth/pairing-token",
  "/api/auth/pairing-links",
  "/api/auth/pairing-links/revoke",
  "/api/auth/clients",
  "/api/auth/clients/revoke",
  "/api/auth/clients/revoke-others",
]);
