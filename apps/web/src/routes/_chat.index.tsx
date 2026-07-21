import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { BotIcon, FolderClosedIcon } from "~/lib/icons";
import { isAgentGroupSession } from "~/agentGroupCapabilities";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { useDesktopTopBarTrafficLightGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";

function ChatIndexRouteView() {
  const navigate = useNavigate();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const hydrated = useStore((state) => state.threadsHydrated);
  const projects = useStore((state) => state.projects);
  const summaries = useStore((state) => state.sidebarThreadSummaryById);
  const projectIds = useMemo(
    () =>
      new Set(
        projects.filter((project) => project.kind === "project").map((project) => project.id),
      ),
    [projects],
  );
  const latestSession = useMemo(
    () =>
      Object.values(summaries)
        .filter((thread) => projectIds.has(thread.projectId) && isAgentGroupSession(thread))
        .toSorted((left, right) =>
          (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt),
        )[0] ?? null,
    [projectIds, summaries],
  );

  useEffect(() => {
    if (!hydrated || !latestSession) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: latestSession.id },
      replace: true,
    });
  }, [hydrated, latestSession, navigate]);

  if (!hydrated || latestSession) return null;

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6">
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center",
          CHAT_SURFACE_HEADER_HEIGHT_CLASS,
          CHAT_SURFACE_HEADER_PADDING_X_CLASS,
          desktopTopBarTrafficLightGutterClassName,
        )}
      >
        <SidebarHeaderNavigationControls />
      </div>
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-foreground/[0.03]">
          {projectIds.size > 0 ? (
            <BotIcon className="size-5 text-muted-foreground" />
          ) : (
            <FolderClosedIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <h1 className="text-lg font-medium tracking-tight">
          {projectIds.size > 0 ? "Create a session" : "Create your first group"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {projectIds.size > 0
            ? "Use the + button beside a group to start a root session."
            : "Add a folder from the left sidebar. Every session gets its own context in the shared workspace."}
        </p>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
