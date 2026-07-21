// FILE: browser-manager/sessionIdentity.ts
// Purpose: Configure the shared browser partition and its Chrome-compatible identity.
// Layer: Desktop browser runtime

import { app, session } from "electron";
import {
  buildAcceptLanguageHeader,
  buildChromeClientHints,
  deriveChromeUserAgent,
} from "@agent-group/shared/browserSession";

import { BROWSER_SESSION_PARTITION } from "./contracts";
import { withRequestHeadersCaseInsensitive } from "./state";

export class BrowserSessionIdentity {
  private spoofedUserAgent: string | null = null;
  private sessionConfigured = false;

  resolveSpoofedUserAgent(): string {
    if (this.spoofedUserAgent === null) {
      this.spoofedUserAgent = deriveChromeUserAgent(app.userAgentFallback, [app.getName()]);
    }
    return this.spoofedUserAgent;
  }

  ensureSessionConfigured(): void {
    if (this.sessionConfigured) return;
    this.sessionConfigured = true;
    try {
      const partitionSession = session.fromPartition(BROWSER_SESSION_PARTITION);
      const userAgent = this.resolveSpoofedUserAgent();
      partitionSession.setUserAgent(userAgent);

      const clientHints = buildChromeClientHints(userAgent, process.platform);
      const acceptLanguage = buildAcceptLanguageHeader(app.getPreferredSystemLanguages());
      partitionSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = withRequestHeadersCaseInsensitive(details.requestHeaders, {
          "User-Agent": userAgent,
          ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
          ...(clientHints ?? {}),
        });
        callback({ requestHeaders });
      });
    } catch {
      this.sessionConfigured = false;
    }
  }
}
