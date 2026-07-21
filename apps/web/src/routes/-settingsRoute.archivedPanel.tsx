// FILE: -settingsRoute.archivedPanel.tsx
// Purpose: Render archived conversations grouped by their project.
// Layer: Settings route panel

import type { ThreadId } from "@agent-group/contracts";

import { SettingsListRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { Button } from "../components/ui/button";
import { ArchiveIcon } from "../lib/icons";
import { formatRelativeTime } from "../lib/relativeTime";
import { cn } from "../lib/utils";
import { SETTINGS_EMPTY_STATE_CLASS_NAME } from "../settingsPanelStyles";
import type { Project, ThreadShell } from "../types";

export interface SettingsArchivedPanelProps {
  projects: ReadonlyArray<Project>;
  archivedThreads: ReadonlyArray<ThreadShell>;
  unarchiveThread: (threadId: ThreadId) => void | Promise<void>;
  deleteArchivedThread: (threadId: ThreadId, threadTitle: string) => void | Promise<void>;
  handleArchivedThreadContextMenu: (
    threadId: ThreadId,
    threadTitle: string,
    position: { x: number; y: number },
  ) => void | Promise<void>;
}

export function SettingsArchivedPanel(props: SettingsArchivedPanelProps) {
  const archivedGroups = [
    ...props.projects.map((project) => ({
      project,
      threads: props.archivedThreads
        .filter((thread) => thread.projectId === project.id)
        .toSorted((left, right) => {
          const leftKey = left.archivedAt ?? left.updatedAt ?? left.createdAt;
          const rightKey = right.archivedAt ?? right.updatedAt ?? right.createdAt;
          return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
        }),
    })),
    ...(() => {
      const knownProjectIds = new Set(props.projects.map((project) => project.id));
      const orphanedThreads = props.archivedThreads
        .filter((thread) => !knownProjectIds.has(thread.projectId))
        .toSorted((left, right) => {
          const leftKey = left.archivedAt ?? left.updatedAt ?? left.createdAt;
          const rightKey = right.archivedAt ?? right.updatedAt ?? right.createdAt;
          return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
        });
      return orphanedThreads.length > 0
        ? [
            {
              project: null,
              threads: orphanedThreads,
            },
          ]
        : [];
    })(),
  ].filter((group) => group.threads.length > 0);

  if (archivedGroups.length === 0) {
    return (
      <div className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-5 py-10 text-center")}>
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground">
          <ArchiveIcon className="size-5" />
        </div>
        <div className="text-sm font-medium text-foreground">No archived threads</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Archived threads will appear here and can be restored to the sidebar.
        </div>
      </div>
    );
  }

  // Each project group is a standard settings card (label + bordered list); the
  // thread rows reuse the same row/typography tokens as every other settings row,
  // and the card's own `divide-y` draws the separators.
  return (
    <div className="space-y-6">
      {archivedGroups.map(({ project, threads: projectThreads }) => (
        <SettingsSection
          key={project?.id ?? "unknown-project"}
          title={project?.name ?? "Unknown project"}
        >
          {projectThreads.map((thread) => (
            <SettingsListRow
              key={thread.id}
              title={thread.title}
              description={`Archived ${formatRelativeTime(thread.archivedAt ?? thread.createdAt)}`}
              onContextMenu={(event) => {
                event.preventDefault();
                void props.handleArchivedThreadContextMenu(thread.id, thread.title, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              actions={
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void props.unarchiveThread(thread.id)}
                  >
                    Restore
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => void props.deleteArchivedThread(thread.id, thread.title)}
                  >
                    Delete
                  </Button>
                </>
              }
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}
