import { describe, expect, it } from "vitest";

import { detectTailnetProxyUrl, resolveTailnetProxyUrl } from "./tailnetProxy";

describe("resolveTailnetProxyUrl", () => {
  it("uses the first supported proxy", () => {
    expect(resolveTailnetProxyUrl("PROXY 127.0.0.1:7890; DIRECT")).toBe("http://127.0.0.1:7890");
  });

  it("supports HTTPS and SOCKS5 PAC results", () => {
    expect(resolveTailnetProxyUrl("HTTPS proxy.example:443")).toBe("https://proxy.example:443");
    expect(resolveTailnetProxyUrl("SOCKS5 [::1]:1080")).toBe("socks5://[::1]:1080");
  });

  it("keeps direct networks direct", () => {
    expect(resolveTailnetProxyUrl("DIRECT")).toBeUndefined();
    expect(resolveTailnetProxyUrl("SOCKS4 127.0.0.1:1080; DIRECT")).toBeUndefined();
  });

  it("rejects credentials and malformed targets", () => {
    expect(resolveTailnetProxyUrl("PROXY user:secret@proxy.example:8080")).toBeUndefined();
    expect(resolveTailnetProxyUrl("PROXY missing-port")).toBeUndefined();
  });
});

describe("detectTailnetProxyUrl", () => {
  it("resolves the control-plane route", async () => {
    let requestedUrl = "";
    await expect(
      detectTailnetProxyUrl(async (url) => {
        requestedUrl = url;
        return "PROXY 127.0.0.1:7890";
      }),
    ).resolves.toBe("http://127.0.0.1:7890");
    expect(requestedUrl).toBe("https://controlplane.tailscale.com/");
  });

  it("does not block startup on a stalled PAC resolver", async () => {
    await expect(detectTailnetProxyUrl(() => new Promise(() => undefined), 1)).rejects.toThrow(
      "timed out",
    );
  });
});
