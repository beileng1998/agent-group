// FILE: CodexInlineVisualization.tsx
// Purpose: Load and render one durable Codex fragment inside a no-origin script sandbox.
// Layer: Web chat presentation

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { showConfirmDialogFallback } from "../../confirmDialogFallback";
import { buildCodexVisualizationUrl } from "../../lib/codexVisualizationUrl";
import { readNativeApi } from "../../nativeApi";
import { buildCodexVisualizationDocument } from "./CodexVisualizationDocument";

const MIN_VISUALIZATION_HEIGHT_PX = 96;
const INITIAL_VISUALIZATION_HEIGHT_PX = 180;
const MAX_VISUALIZATION_HEIGHT_PX = 1_200;
const MAX_FOLLOW_UP_PROMPT_CHARS = 8_000;
const MAX_FOLLOW_UP_TITLE_CHARS = 250;

type VisualizationStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly fragment: string }
  | { readonly kind: "error" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function CodexInlineVisualization(props: {
  readonly fileName: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly theme: "light" | "dark";
  readonly onFollowUp?: ((prompt: string) => boolean | Promise<boolean>) | undefined;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const followUpPendingRef = useRef(false);
  const bridgeToken = useId();
  const [height, setHeight] = useState(INITIAL_VISUALIZATION_HEIGHT_PX);
  const [status, setStatus] = useState<VisualizationStatus>({ kind: "loading" });
  const [followUpFailed, setFollowUpFailed] = useState(false);
  const url = useMemo(
    () =>
      buildCodexVisualizationUrl({
        threadId: props.threadId,
        messageId: props.messageId,
        fileName: props.fileName,
      }),
    [props.fileName, props.messageId, props.threadId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    void fetch(url, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Visualization request failed (${response.status})`);
        return response.text();
      })
      .then((fragment) => setStatus({ kind: "ready", fragment }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus({ kind: "error" });
      });
    return () => controller.abort();
  }, [url]);

  const document = useMemo(
    () =>
      status.kind === "ready"
        ? buildCodexVisualizationDocument({
            fragment: status.fragment,
            theme: props.theme,
            bridgeToken,
          })
        : null,
    [bridgeToken, props.theme, status],
  );

  useEffect(() => {
    if (!document) return;
    const respondToFollowUp = (requestId: string, ok: boolean) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "agent-group.visualization.follow-up-result",
          token: bridgeToken,
          requestId,
          ok,
        },
        "*",
      );
    };
    const handleFollowUp = async (data: Record<string, unknown>) => {
      const requestId = typeof data.requestId === "string" ? data.requestId : "";
      const payload = asRecord(data.payload);
      const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
      const title = typeof payload?.title === "string" ? payload.title.trim() : "";
      if (
        !requestId ||
        !prompt ||
        prompt.length > MAX_FOLLOW_UP_PROMPT_CHARS ||
        prompt.startsWith("/") ||
        title.length > MAX_FOLLOW_UP_TITLE_CHARS ||
        title.includes("\n") ||
        (payload !== null && "title" in payload && typeof payload.title !== "string") ||
        followUpPendingRef.current ||
        !props.onFollowUp
      ) {
        respondToFollowUp(requestId, false);
        setFollowUpFailed(true);
        return;
      }
      followUpPendingRef.current = true;
      setFollowUpFailed(false);
      if (title) {
        const api = readNativeApi();
        const confirmed = await (
          api ? api.dialogs.confirm(title) : showConfirmDialogFallback(title)
        ).catch(() => false);
        if (!confirmed) {
          followUpPendingRef.current = false;
          respondToFollowUp(requestId, false);
          return;
        }
      }
      const ok = await Promise.resolve(props.onFollowUp(prompt)).catch(() => false);
      followUpPendingRef.current = false;
      setFollowUpFailed(!ok);
      respondToFollowUp(requestId, ok);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = asRecord(event.data);
      if (!data || data.token !== bridgeToken) return;
      if (data.type === "agent-group.visualization.height" && typeof data.height === "number") {
        const nextHeight = Math.min(
          MAX_VISUALIZATION_HEIGHT_PX,
          Math.max(MIN_VISUALIZATION_HEIGHT_PX, Math.ceil(data.height) + 2),
        );
        setHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
        return;
      }
      if (data.type === "agent-group.visualization.follow-up") {
        void handleFollowUp(data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridgeToken, document, props.onFollowUp]);

  if (status.kind === "loading") {
    return (
      <div
        className="my-2 w-full rounded-xl border border-border/45 bg-muted/20"
        style={{ height: INITIAL_VISUALIZATION_HEIGHT_PX }}
        role="status"
        aria-label="Loading visualization"
      />
    );
  }
  if (status.kind === "error" || !document) {
    return (
      <div className="my-2 rounded-xl border border-border/45 bg-muted/15 px-3 py-2 text-xs text-muted-foreground/70">
        Visualization unavailable
      </div>
    );
  }

  return (
    <div className="my-2 w-full">
      <iframe
        ref={iframeRef}
        title={`Visualization: ${props.fileName.replace(/\.html$/u, "")}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        srcDoc={document}
        className="block w-full rounded-xl border border-border/45 bg-transparent"
        style={{ height }}
      />
      {followUpFailed ? (
        <p className="mt-1 text-xs text-muted-foreground/70">Could not send this selection.</p>
      ) : null}
    </div>
  );
}
