export type PwaInstallOutcome = "accepted" | "dismissed";

type BeforeInstallPromptEvent = Event & {
  readonly userChoice: Promise<{ readonly outcome: PwaInstallOutcome }>;
  prompt(): Promise<void>;
};

let initialized = false;
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;
let installedInCurrentPage = false;
const installPromptListeners = new Set<() => void>();

function notifyInstallPromptListeners(): void {
  for (const listener of installPromptListeners) listener();
}

export function subscribeToPwaInstallPrompt(listener: () => void): () => void {
  installPromptListeners.add(listener);
  return () => installPromptListeners.delete(listener);
}

export function isPwaInstallPromptAvailable(): boolean {
  return pendingInstallPrompt !== null;
}

function isRunningStandalone(): boolean {
  const standaloneNavigator = navigator as Navigator & { readonly standalone?: boolean };
  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

export function shouldShowPwaInstallFallback(): boolean {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    window.desktopBridge ||
    !window.isSecureContext ||
    installedInCurrentPage ||
    isRunningStandalone()
  ) {
    return false;
  }

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function promptPwaInstallation(): Promise<PwaInstallOutcome | null> {
  const prompt = pendingInstallPrompt;
  if (!prompt) return null;

  try {
    await prompt.prompt();
    const outcome = (await prompt.userChoice).outcome;
    if (outcome === "accepted") installedInCurrentPage = true;
    return outcome;
  } finally {
    if (pendingInstallPrompt === prompt) {
      pendingInstallPrompt = null;
      notifyInstallPromptListeners();
    }
  }
}

export function registerAgentGroupPwa(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined" || window.desktopBridge) {
    return;
  }

  if (!initialized) {
    initialized = true;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      pendingInstallPrompt = event as BeforeInstallPromptEvent;
      notifyInstallPromptListeners();
    });
    window.addEventListener("appinstalled", () => {
      installedInCurrentPage = true;
      pendingInstallPrompt = null;
      notifyInstallPromptListeners();
    });
  }

  if (!("serviceWorker" in navigator)) return;
  const registerServiceWorker = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((cause: unknown) => {
      console.warn("Agent Group service worker registration failed.", cause);
    });
  };
  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}
