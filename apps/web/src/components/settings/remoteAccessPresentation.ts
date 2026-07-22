import type { RemoteAccessStatus, RemoteAccessTransport } from "@agent-group/contracts";

export function hasRemoteAccessLoginFailure(status: RemoteAccessStatus | undefined): boolean {
  if (status?.state !== "needs-login" || status.authUrl) return false;
  return status.health.some((message) => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("last login error") ||
      normalized.includes("register request") ||
      normalized.includes("context deadline exceeded")
    );
  });
}

export function remoteAccessStatusCopy(status: RemoteAccessStatus | undefined): {
  readonly title: string;
  readonly detail: string;
} {
  if (!status) return { title: "Checking", detail: "Reading the Tailnet service state…" };
  switch (status.state) {
    case "disabled":
      return { title: "Off", detail: "No Tailnet listener is running." };
    case "unavailable":
      return {
        title: "Unavailable",
        detail: status.message ?? "This build has no Tailnet sidecar.",
      };
    case "starting":
      return { title: "Starting", detail: "Starting the private userspace Tailnet node…" };
    case "needs-login":
      if (hasRemoteAccessLoginFailure(status)) {
        return {
          title: "Could not reach Tailscale",
          detail: "The sign-in request timed out. Check your connection and try again.",
        };
      }
      return status.authUrl
        ? { title: "Sign in required", detail: "Complete the one-time sign-in in your browser." }
        : { title: "Preparing sign-in", detail: "Creating a secure Tailscale sign-in link…" };
    case "needs-approval":
      return {
        title: "Device approval required",
        detail: "Approve this host in the Tailscale admin console.",
      };
    case "ready":
      return {
        title: "Ready",
        detail: [status.url ?? "Private Tailnet access is available.", status.message]
          .filter(Boolean)
          .join(" · "),
      };
    case "error":
      return {
        title: "Needs attention",
        detail: status.message ?? "The Tailnet sidecar stopped unexpectedly.",
      };
  }
}

export function mobilePairingInstructions(transport: RemoteAccessTransport | undefined): string {
  if (transport === "http") {
    return "On your phone, connect Tailscale and scan this code. Use Agent Group in the browser; installing it as an app requires Tailnet HTTPS.";
  }
  return "On your phone, connect Tailscale and scan this code. Then use your browser's Install app or Add to Home Screen action.";
}

export function needsTailnetHttpsSetup(status: RemoteAccessStatus | undefined): boolean {
  return status?.state === "ready" && status.transport === "http";
}
