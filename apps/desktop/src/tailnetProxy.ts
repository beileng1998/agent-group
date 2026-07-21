// FILE: tailnetProxy.ts
// Purpose: Converts Electron's OS/PAC proxy result into a sidecar-only proxy URL.

const PROXY_SCHEMES: Readonly<Record<string, string>> = {
  PROXY: "http:",
  HTTPS: "https:",
  SOCKS: "socks5:",
  SOCKS5: "socks5:",
};

const CONTROL_PLANE_URL = "https://controlplane.tailscale.com/";

export async function detectTailnetProxyUrl(
  resolveProxy: (url: string) => Promise<string>,
  timeoutMs = 2_500,
): Promise<string | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const proxyRules = await Promise.race([
      resolveProxy(CONTROL_PLANE_URL),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("System proxy resolution timed out.")),
          timeoutMs,
        );
      }),
    ]);
    return resolveTailnetProxyUrl(proxyRules);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function resolveTailnetProxyUrl(proxyRules: string): string | undefined {
  for (const rawRule of proxyRules.split(";")) {
    const [rawKind, ...targetParts] = rawRule.trim().split(/\s+/);
    const kind = rawKind?.toUpperCase();
    if (!kind) continue;
    if (kind === "DIRECT") return undefined;

    const scheme = PROXY_SCHEMES[kind];
    const target = targetParts.join("");
    if (!scheme || !target) continue;
    try {
      const parsed = new URL(`${scheme}//${target}`);
      const port = Number(target.match(/:(\d+)$/)?.[1]);
      if (
        !parsed.hostname ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535 ||
        parsed.username ||
        parsed.password
      ) {
        continue;
      }
      return `${parsed.protocol}//${target}`;
    } catch {
      // Ignore malformed or unsupported directives and try the next PAC result.
    }
  }
  return undefined;
}
