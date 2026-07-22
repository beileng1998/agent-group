import type { RemoteAccessStatus } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import {
  mobilePairingInstructions,
  needsTailnetHttpsSetup,
  remoteAccessStatusCopy,
} from "./remoteAccessPresentation";

function status(overrides: Partial<RemoteAccessStatus>): RemoteAccessStatus {
  return {
    enabled: true,
    state: "ready",
    hostname: "agent-group",
    processName: "agent-group-tailnet",
    health: [],
    ...overrides,
  };
}

describe("remote access presentation", () => {
  it("does not surface upstream health diagnostics while access is ready", () => {
    const copy = remoteAccessStatusCopy(
      status({
        url: "http://agent-group.example.ts.net",
        health: ["macOS Screen Time seems to be blocking Tailscale."],
      }),
    );

    expect(copy).toEqual({ title: "Ready", detail: "http://agent-group.example.ts.net" });
  });

  it("surfaces the sidecar's measured relay route while ready", () => {
    const copy = remoteAccessStatusCopy(
      status({
        url: "https://agent-group.example.ts.net",
        message: "Adaptive relay preference: hkg (314 ms; current sfo 653 ms).",
      }),
    );

    expect(copy.detail).toContain("Adaptive relay preference: hkg");
  });

  it("turns login transport failures into a short actionable status", () => {
    const copy = remoteAccessStatusCopy(
      status({
        state: "needs-login",
        health: ["last login error: register request: context deadline exceeded"],
      }),
    );

    expect(copy).toEqual({
      title: "Could not reach Tailscale",
      detail: "The sign-in request timed out. Check your connection and try again.",
    });
  });

  it("mentions the HTTPS limitation only in HTTP pairing instructions", () => {
    expect(mobilePairingInstructions("http")).toContain(
      "installing it as an app requires Tailnet HTTPS",
    );
    expect(mobilePairingInstructions("https")).not.toContain("requires Tailnet HTTPS");
  });

  it("offers HTTPS setup only while the ready endpoint is still HTTP", () => {
    expect(needsTailnetHttpsSetup(status({ transport: "http" }))).toBe(true);
    expect(needsTailnetHttpsSetup(status({ transport: "https" }))).toBe(false);
    expect(needsTailnetHttpsSetup(status({ state: "starting", transport: "http" }))).toBe(false);
  });
});
