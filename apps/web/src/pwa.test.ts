import { afterEach, describe, expect, it, vi } from "vitest";

describe("PWA install prompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("captures the browser prompt and exposes one explicit install action", async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      desktopBridge: undefined,
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 15)" });

    const pwa = await import("./pwa");
    pwa.registerAgentGroupPwa();

    let promptCount = 0;
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        promptCount += 1;
      },
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    browserWindow.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(pwa.isPwaInstallPromptAvailable()).toBe(true);
    await expect(pwa.promptPwaInstallation()).resolves.toBe("accepted");
    expect(promptCount).toBe(1);
    expect(pwa.isPwaInstallPromptAvailable()).toBe(false);
    expect(pwa.shouldShowPwaInstallFallback()).toBe(false);
    await expect(pwa.promptPwaInstallation()).resolves.toBeNull();
  });

  it("offers Android users manual installation help when Chrome withholds its prompt", async () => {
    vi.stubGlobal("window", {
      desktopBridge: undefined,
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 15)" });

    const pwa = await import("./pwa");

    expect(pwa.isPwaInstallPromptAvailable()).toBe(false);
    expect(pwa.shouldShowPwaInstallFallback()).toBe(true);
  });
});
