import type { AgentGroupSessionDocument, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useGroupSettingsStore } from "~/groupSettingsStore";
import { FileIcon, Loader2Icon, RefreshCwIcon, SettingsIcon } from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";

interface AgentGroupContextPaneProps {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
}

export default function AgentGroupContextPane(props: AgentGroupContextPaneProps) {
  const [document, setDocument] = useState<AgentGroupSessionDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const observedThreadVersionRef = useRef<string | undefined>(props.threadUpdatedAt);
  const latestThreadVersionRef = useRef<string | undefined>(props.threadUpdatedAt);
  latestThreadVersionRef.current = props.threadUpdatedAt;

  const load = useCallback(
    async (background = false) => {
      const api = readNativeApi();
      if (!api) {
        setError("The Agent Group service is unavailable.");
        setLoading(false);
        return;
      }
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setDocument(await api.agentGroup.getSession({ sessionId: props.sessionId }));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Context could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [props.sessionId],
  );

  useEffect(() => {
    setDocument(null);
    observedThreadVersionRef.current = latestThreadVersionRef.current;
    void load();
  }, [load]);

  useEffect(() => {
    if (
      !document ||
      !props.threadUpdatedAt ||
      observedThreadVersionRef.current === props.threadUpdatedAt
    ) {
      return;
    }
    observedThreadVersionRef.current = props.threadUpdatedAt;
    void load(true);
  }, [document, load, props.threadUpdatedAt]);

  const openGroupSettings = useCallback(() => {
    if (document) useGroupSettingsStore.getState().open(document.config.groupId);
  }, [document]);

  if (loading && !document) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Loader2Icon className="me-2 size-3.5 animate-spin" /> Loading context
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{error ?? "Context unavailable."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCwIcon className="size-3.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileIcon className="size-3.5 text-muted-foreground" /> Session
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
              Inspector
            </span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">Current Session context</div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open group settings"
            title="Open group settings"
            onClick={openGroupSettings}
          >
            <SettingsIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh session inspector"
            title="Refresh session inspector"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <RefreshCwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium">
          <FileIcon className="size-3.5 text-muted-foreground" /> Context
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
            Read-only
          </span>
        </div>
        {document.context.trim() ? (
          // Same typography as the chat transcript/composer: the shared chat font
          // size var (Appearance setting) with the transcript's leading-relaxed.
          <ChatMarkdown
            text={document.context}
            cwd={document.workspaceRoot}
            isStreaming={false}
            className="text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[length:var(--app-font-size-chat,12px)] text-muted-foreground">
            This session has no context yet.
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-muted/10 px-4 py-2">
        <div
          className="truncate font-mono text-[9px] text-muted-foreground/70"
          title={document.contextPath}
        >
          {document.contextPath}
        </div>
      </div>
    </div>
  );
}
