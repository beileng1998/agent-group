// FILE: RemoteAccessSettingsPanel.tsx
// Purpose: Host-only setup for private Tailnet access, device pairing, and revocation.

import type {
  AuthClientSession,
  AuthPairingCredentialResult,
  RemoteAccessStatus,
} from "@agent-group/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsListRow, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";
import {
  mobilePairingInstructions,
  needsTailnetHttpsSetup,
  remoteAccessStatusCopy,
} from "./remoteAccessPresentation";
import { RemoteAccessHttpsSetup } from "./RemoteAccessHttpsSetup";

const REMOTE_STATUS_QUERY_KEY = ["server", "remoteAccess", "status"] as const;
const AUTH_CLIENTS_QUERY_KEY = ["server", "auth", "clients"] as const;
const TAILSCALE_DNS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The operation failed.";
}

function toPairingUrl(baseUrl: string, credential: string): string {
  return `${baseUrl.replace(/\/$/, "")}/pair#token=${encodeURIComponent(credential)}`;
}

function asEpochMillis(value: unknown): number | null {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "epochMillis" in value) {
    const epochMillis = (value as { readonly epochMillis?: unknown }).epochMillis;
    return typeof epochMillis === "number" ? epochMillis : null;
  }
  return null;
}

function formatLastSeen(client: AuthClientSession): string {
  if (client.connected) return "Connected now";
  const timestamp = asEpochMillis(client.lastConnectedAt ?? client.issuedAt);
  return timestamp ? `Last connected ${new Date(timestamp).toLocaleString()}` : "Not connected yet";
}

function describeClient(client: AuthClientSession): string {
  return [client.client.deviceType, client.client.os, client.client.browser]
    .filter(Boolean)
    .join(" · ");
}

export function RemoteAccessSettingsPanel() {
  const isDesktopOwner = Boolean(window.desktopBridge);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    ...serverSettingsQueryOptions(),
    enabled: isDesktopOwner,
  });
  const statusQuery = useQuery({
    queryKey: REMOTE_STATUS_QUERY_KEY,
    queryFn: () => ensureNativeApi().server.getRemoteAccessStatus(),
    enabled: isDesktopOwner,
    refetchInterval: 1_500,
  });
  const clientsQuery = useQuery({
    queryKey: AUTH_CLIENTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().server.listAuthClients(),
    enabled: isDesktopOwner,
    refetchInterval: 4_000,
  });
  const status = statusQuery.data;
  const refetchRemoteStatus = statusQuery.refetch;
  const remoteSettings = settingsQuery.data?.remoteAccess;
  const [busy, setBusy] = useState(false);
  const [hostname, setHostname] = useState("agent-group");
  const [pairing, setPairing] = useState<AuthPairingCredentialResult | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const openAuthWhenReadyRef = useRef(false);
  const recheckHttpsOnFocusRef = useRef(false);
  const clients = useMemo(
    () => (clientsQuery.data ?? []).filter((client) => client.role === "client"),
    [clientsQuery.data],
  );
  const stateCopy = remoteAccessStatusCopy(status);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      toastManager.add({ type: "error", title: "Mobile access", description: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }, []);

  const restartAndRefetch = useCallback(async () => {
    await ensureNativeApi().server.restartRemoteAccess();
    await refetchRemoteStatus();
  }, [refetchRemoteStatus]);

  useEffect(() => {
    if (remoteSettings?.hostname) setHostname(remoteSettings.hostname);
  }, [remoteSettings?.hostname]);

  useEffect(() => {
    if (status?.state !== "needs-login" || !status.authUrl || !openAuthWhenReadyRef.current) {
      return;
    }
    openAuthWhenReadyRef.current = false;
    void ensureNativeApi()
      .shell.openExternal(status.authUrl)
      .catch(() => {
        toastManager.add({
          type: "error",
          title: "Could not open Tailscale sign-in",
          description: "Use the sign-in button to try again.",
        });
      });
  }, [status?.authUrl, status?.state]);

  useEffect(() => {
    if (!pairing || !status?.url) {
      setPairingUrl(null);
      setQrDataUrl(null);
      return;
    }
    const url = toPairingUrl(status.url, pairing.credential);
    setPairingUrl(url);
    let disposed = false;
    void QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!disposed) setQrDataUrl(dataUrl);
    });
    return () => {
      disposed = true;
    };
  }, [pairing, status?.url]);

  useEffect(() => {
    const recheckOnReturn = () => {
      if (!recheckHttpsOnFocusRef.current) return;
      recheckHttpsOnFocusRef.current = false;
      void run(restartAndRefetch);
    };
    window.addEventListener("focus", recheckOnReturn);
    return () => window.removeEventListener("focus", recheckOnReturn);
  }, [restartAndRefetch, run]);

  const updateRemoteSettings = async (patch: { enabled?: boolean; hostname?: string }) => {
    const next = await ensureNativeApi().server.updateSettings({ remoteAccess: patch });
    queryClient.setQueryData(serverQueryKeys.settings(), next);
    await statusQuery.refetch();
  };

  const toggleEnabled = (enabled: boolean) =>
    void run(async () => {
      openAuthWhenReadyRef.current = enabled;
      await updateRemoteSettings({ enabled });
      if (!enabled && pairing) {
        await ensureNativeApi().server.revokeAuthPairingLink({ id: pairing.id });
        setPairing(null);
      }
    });

  const saveHostname = () =>
    void run(async () => {
      const normalized = hostname.trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
        throw new Error("Use 1–63 lowercase letters, numbers, or hyphens.");
      }
      await updateRemoteSettings({ hostname: normalized });
      setHostname(normalized);
    });

  const createPairingCode = () =>
    void run(async () => {
      if (pairing) await ensureNativeApi().server.revokeAuthPairingLink({ id: pairing.id });
      setPairing(await ensureNativeApi().server.createAuthPairingToken({ label: "Mobile device" }));
    });

  const openTailscaleDnsSettings = () => {
    recheckHttpsOnFocusRef.current = true;
    void run(async () => {
      try {
        await ensureNativeApi().shell.openExternal(TAILSCALE_DNS_SETTINGS_URL);
      } catch (cause) {
        recheckHttpsOnFocusRef.current = false;
        throw cause;
      }
    });
  };

  const recheckHttps = () => void run(restartAndRefetch);

  const cancelPairing = () =>
    void run(async () => {
      if (pairing) await ensureNativeApi().server.revokeAuthPairingLink({ id: pairing.id });
      setPairing(null);
    });

  const revokeClient = (client: AuthClientSession) =>
    void run(async () => {
      const confirmed = await ensureNativeApi().dialogs.confirm(
        `Revoke access for ${client.client.label ?? "this device"}?`,
      );
      if (!confirmed) return;
      await ensureNativeApi().server.revokeAuthClient({ sessionId: client.sessionId });
      await clientsQuery.refetch();
    });

  const resetTailnet = () =>
    void run(async () => {
      const confirmed = await ensureNativeApi().dialogs.confirm(
        "Reset the Tailnet identity? You will need to sign in and pair devices again.",
      );
      if (!confirmed) return;
      openAuthWhenReadyRef.current = true;
      await ensureNativeApi().server.resetRemoteAccess();
      setPairing(null);
      await statusQuery.refetch();
    });

  const copyText = (text: string, title: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toastManager.add({ type: "success", title }),
      () => toastManager.add({ type: "error", title: "Could not copy" }),
    );

  if (!isDesktopOwner) {
    return (
      <SettingsSection title="Mobile access">
        <SettingsRow
          title="Manage on the host"
          description="Tailnet setup, pairing codes, and device revocation are available only in the Agent Group desktop app."
        />
      </SettingsSection>
    );
  }

  return (
    <div>
      <SettingsSection title="Private access">
        <SettingsRow
          title="Mobile access"
          description="Run a userspace Tailscale node inside Agent Group. The server remains bound to localhost."
          status={`${stateCopy.title} · ${stateCopy.detail}`}
          control={
            <Switch
              checked={remoteSettings?.enabled ?? false}
              disabled={busy || settingsQuery.isLoading}
              onCheckedChange={toggleEnabled}
              aria-label="Mobile access"
            />
          }
        >
          {status?.state === "needs-login" ? (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={!status.authUrl}
                onClick={() =>
                  status.authUrl && void ensureNativeApi().shell.openExternal(status.authUrl)
                }
              >
                {status.authUrl ? "Sign in to Tailscale" : "Preparing sign-in…"}
              </Button>
              {!status.authUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      openAuthWhenReadyRef.current = true;
                      await ensureNativeApi().server.restartRemoteAccess();
                    })
                  }
                >
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          {status?.state === "needs-approval" ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() =>
                void ensureNativeApi().shell.openExternal(
                  "https://login.tailscale.com/admin/machines",
                )
              }
            >
              Open device approvals
            </Button>
          ) : null}
          {status?.state === "error" || status?.state === "unavailable" ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ensureNativeApi().server.restartRemoteAccess();
                })
              }
            >
              Retry
            </Button>
          ) : null}
          {needsTailnetHttpsSetup(status) ? (
            <RemoteAccessHttpsSetup
              busy={busy}
              onOpenDnsSettings={openTailscaleDnsSettings}
              onRecheck={recheckHttps}
            />
          ) : null}
        </SettingsRow>
        <SettingsRow
          title="Tailnet hostname"
          description="Changing this restarts the embedded Tailnet node; it does not expose a public DNS name."
          control={
            <div className="flex w-full gap-2 sm:w-64">
              <Input
                value={hostname}
                disabled={busy}
                onChange={(event) => setHostname(event.target.value)}
              />
              <Button size="sm" variant="outline" disabled={busy} onClick={saveHostname}>
                Save
              </Button>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Pair a device">
        <SettingsRow
          title="One-time pairing code"
          description="The code expires after five minutes and can be used once. Pairing creates a revocable HttpOnly session."
          control={
            status?.state === "ready" ? (
              <Button size="sm" disabled={busy} onClick={createPairingCode}>
                {pairing ? "New code" : "Create code"}
              </Button>
            ) : undefined
          }
        >
          {pairingUrl ? (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="size-[220px] shrink-0 rounded-xl bg-white p-2">
                {qrDataUrl ? <img src={qrDataUrl} alt="One-time mobile pairing QR code" /> : null}
              </div>
              <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
                <p>{mobilePairingInstructions(status?.transport)}</p>
                <p className="break-all font-mono">{pairingUrl}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(pairingUrl, "Pairing link copied")}
                  >
                    Copy link
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={cancelPairing}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Paired devices">
        {clientsQuery.isLoading ? (
          <SettingsListRow title="Loading devices…" />
        ) : clients.length === 0 ? (
          <SettingsListRow
            title="No paired devices"
            description="Create a pairing code to add an iPhone, iPad, or Android device."
          />
        ) : (
          clients.map((client) => (
            <SettingsListRow
              key={client.sessionId}
              title={client.client.label ?? "Paired device"}
              description={`${describeClient(client)} · ${formatLastSeen(client)}`}
              actions={
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={busy}
                  onClick={() => revokeClient(client)}
                >
                  Revoke
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="Troubleshooting">
        <SettingsRow
          title="Reset Tailnet identity"
          description="Use only when moving to another Tailnet or when sign-in cannot be repaired automatically."
          control={
            <Button size="sm" variant="destructive-outline" disabled={busy} onClick={resetTailnet}>
              Reset identity
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
