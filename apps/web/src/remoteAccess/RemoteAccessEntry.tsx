import type { AuthSessionState } from "@agent-group/contracts";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "../index.css";

type EntryState =
  | { readonly kind: "pairing" }
  | { readonly kind: "paired" }
  | { readonly kind: "needs-pairing" }
  | { readonly kind: "error"; readonly message: string };

function readAndClearPairingToken(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  const token = new URLSearchParams(hash).get("token")?.trim() ?? "";
  if (window.location.hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return token || null;
}

async function readSession(): Promise<AuthSessionState | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!response.ok) return null;
  return (await response.json()) as AuthSessionState;
}

async function exchangePairingToken(token: string): Promise<void> {
  const response = await fetch("/api/auth/bootstrap", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: token }),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(
    typeof payload?.error === "string" ? payload.error : "This pairing link is invalid or expired.",
  );
}

function EntryCard({ initialState }: { readonly initialState: EntryState }) {
  const [state, setState] = useState<EntryState>(initialState);

  useEffect(() => {
    if (initialState.kind === "error") return;
    let disposed = false;
    const token = readAndClearPairingToken();
    void (async () => {
      try {
        const session = await readSession();
        if (session?.authenticated) {
          if (!disposed) setState({ kind: "paired" });
          window.location.replace("/");
          return;
        }
        if (!token) {
          if (!disposed) setState({ kind: "needs-pairing" });
          return;
        }
        await exchangePairingToken(token);
        if (!disposed) setState({ kind: "paired" });
        window.location.replace("/");
      } catch (cause) {
        if (!disposed) {
          setState({
            kind: "error",
            message: cause instanceof Error ? cause.message : "Pairing failed.",
          });
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [initialState.kind]);

  const title =
    state.kind === "pairing"
      ? "Pairing this device…"
      : state.kind === "paired"
        ? "Device paired"
        : state.kind === "needs-pairing"
          ? "Pairing required"
          : "Couldn’t pair this device";
  const detail =
    state.kind === "pairing"
      ? "Keep this page open for a moment."
      : state.kind === "paired"
        ? "Opening Agent Group…"
        : state.kind === "needs-pairing"
          ? "Open Agent Group on your host, then go to Settings → Mobile access and scan a new code."
          : state.message;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 text-center shadow-sm">
        <img
          src="/agent-group-logo.svg"
          alt=""
          className="mx-auto mb-5 size-16"
          draggable={false}
        />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        {state.kind === "pairing" ? (
          <div
            aria-label="Pairing"
            className="mx-auto mt-6 size-5 animate-spin rounded-full border-2 border-muted border-t-foreground"
          />
        ) : null}
        {state.kind === "error" ? (
          <button
            type="button"
            className="mt-6 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function renderRemoteAccessEntry(): void {
  document.title = "Pair device · Agent Group";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <EntryCard initialState={{ kind: "pairing" }} />,
  );
}

export function renderRemoteAccessError(message: string): void {
  document.title = "Connection problem · Agent Group";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <EntryCard initialState={{ kind: "error", message }} />,
  );
}
