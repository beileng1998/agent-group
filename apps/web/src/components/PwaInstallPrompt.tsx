import { useState, useSyncExternalStore } from "react";

import { isElectron } from "~/env";
import { XIcon } from "~/lib/icons";
import {
  isPwaInstallPromptAvailable,
  promptPwaInstallation,
  shouldShowPwaInstallFallback,
  subscribeToPwaInstallPrompt,
} from "~/pwa";
import { Button } from "~/components/ui/button";
import { EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME } from "~/components/ui/notificationSurface";
import { cn } from "~/lib/utils";

export function PwaInstallPrompt() {
  const available = useSyncExternalStore(
    subscribeToPwaInstallPrompt,
    isPwaInstallPromptAvailable,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showFallback = shouldShowPwaInstallFallback();

  if (isElectron || (!available && !showFallback) || dismissed) return null;

  const install = () => {
    setInstalling(true);
    setError(null);
    void promptPwaInstallation()
      .catch(() => {
        setError("Open the browser menu and choose Install app.");
      })
      .finally(() => setInstalling(false));
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[220] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <section
        aria-live="polite"
        className={cn(
          EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
          "pointer-events-auto relative max-w-sm p-4 pr-10",
        )}
      >
        <button
          type="button"
          aria-label="Dismiss install prompt"
          className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-full text-[var(--notification-fg)]/65 transition-colors hover:bg-[var(--notification-fg)]/10 hover:text-[var(--notification-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--notification-fg)]/35"
          disabled={installing}
          onClick={() => setDismissed(true)}
        >
          <XIcon className="size-3.5" />
        </button>
        <h2 className="text-sm font-semibold">Install Agent Group</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--notification-fg)]/72">
          {available
            ? "Open Agent Group from your home screen in a clean app window without browser controls."
            : "Open Chrome’s ⋮ menu and choose Install app. If it shows Add to Home screen, open it and choose Install."}
        </p>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-3 flex items-center gap-2">
          {available ? (
            <Button size="sm" disabled={installing} onClick={install}>
              {installing ? "Opening…" : "Install app"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={installing}
            onClick={() => setDismissed(true)}
          >
            {available ? "Not now" : "Got it"}
          </Button>
        </div>
      </section>
    </div>
  );
}
