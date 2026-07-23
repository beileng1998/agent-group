// FILE: bootstrap.ts
// Purpose: Completes synchronous renderer storage migration before any app store can hydrate.

import "./storageOriginMigration";

import {
  refreshBrowserWebSocketToken,
  setBrowserWebSocketTokenResult,
} from "./browserWebSocketAuth";
import { registerAgentGroupPwa } from "./pwa";

// Chrome can decide that an existing Service Worker makes the app installable
// before the authenticated application bundle finishes loading. Capture that
// one-shot event before any session or WebSocket bootstrap awaits.
registerAgentGroupPwa();

async function startRenderer() {
  if (!window.desktopBridge && window.location.pathname === "/pair") {
    const { renderRemoteAccessEntry } = await import("./remoteAccess/RemoteAccessEntry");
    renderRemoteAccessEntry();
    return;
  }

  if (!window.desktopBridge) {
    try {
      const response = await fetch("/api/auth/session?includeWebSocketToken=1", {
        credentials: "same-origin",
      });
      const session = (await response.json()) as {
        readonly authenticated?: boolean;
        readonly auth?: { readonly policy?: string };
        readonly websocketToken?: { readonly token: string; readonly expiresAt: string };
      };
      if (!session.authenticated && session.auth?.policy !== "unsafe-no-auth") {
        const { renderRemoteAccessEntry } = await import("./remoteAccess/RemoteAccessEntry");
        renderRemoteAccessEntry();
        return;
      }
      if (session.authenticated && session.auth?.policy !== "unsafe-no-auth") {
        if (session.websocketToken) setBrowserWebSocketTokenResult(session.websocketToken);
        else await refreshBrowserWebSocketToken();
      }
    } catch {
      const { renderRemoteAccessError } = await import("./remoteAccess/RemoteAccessEntry");
      renderRemoteAccessError(
        "Couldn’t establish a secure connection to the Agent Group host. Check Mobile Access and try again.",
      );
      return;
    }

    const { hydrateCachedRemoteBootstrapForCurrentRoute, startRemoteBootstrapFallbackSync } =
      await import("./remoteBootstrapHydration");
    await hydrateCachedRemoteBootstrapForCurrentRoute();
    startRemoteBootstrapFallbackSync();
  }

  await import("./main");
}

void startRenderer();
