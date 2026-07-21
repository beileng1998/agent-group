// FILE: -settingsRoute.worktreesPanel.tsx
// Purpose: Render managed worktrees grouped by workspace root.
// Layer: Settings route panel

import { Button } from "../components/ui/button";
import { SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { cn } from "../lib/utils";
import {
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
  SETTINGS_EMPTY_STATE_CLASS_NAME,
} from "../settingsPanelStyles";

export interface SettingsWorktreeGroup {
  workspaceRoot: string;
  worktrees: ReadonlyArray<{
    path: string;
    linkedThreads: ReadonlyArray<{
      id: string;
      title: string;
    }>;
  }>;
}

export interface SettingsWorktreesPanelProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  worktreesByWorkspaceRoot: ReadonlyArray<SettingsWorktreeGroup>;
  deletePending: boolean;
  deleteManagedWorktree: (input: {
    workspaceRoot: string;
    worktreePath: string;
  }) => void | Promise<void>;
}

export function SettingsWorktreesPanel(props: SettingsWorktreesPanelProps) {
  if (props.isLoading) {
    return (
      <div
        className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-4 py-6 text-sm text-muted-foreground")}
      >
        Loading managed worktrees...
      </div>
    );
  }
  if (props.isError) {
    return (
      <div
        className={cn(
          SETTINGS_EMPTY_STATE_CLASS_NAME,
          "border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive",
        )}
      >
        {props.error instanceof Error ? props.error.message : "Unable to load worktrees."}
      </div>
    );
  }
  if (props.worktreesByWorkspaceRoot.length === 0) {
    return (
      <div
        className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-4 py-6 text-sm text-muted-foreground")}
      >
        No app-managed worktrees found yet.
      </div>
    );
  }

  // Each workspace root is a standard settings card; worktree rows reuse the
  // same row chrome/typography as every other settings list (separators come
  // from the card's `divide-y`), with their richer body kept top-aligned.
  return (
    <div className="space-y-6">
      {props.worktreesByWorkspaceRoot.map((group) => (
        <SettingsSection key={group.workspaceRoot} title={group.workspaceRoot}>
          {group.worktrees.map((worktree) => {
            const deleteDisabled = props.deletePending;
            return (
              <div
                key={worktree.path}
                className={SETTINGS_CARD_ROW_CLASS_NAME}
                data-slot="settings-row"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="space-y-0.5">
                      <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>Worktree</div>
                      <div
                        className={cn(
                          SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                          "truncate font-mono",
                        )}
                      >
                        {worktree.path}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        Conversations
                      </div>
                      {worktree.linkedThreads.length > 0 ? (
                        <div className="space-y-1">
                          {worktree.linkedThreads.map((thread) => (
                            <div
                              key={thread.id}
                              className={cn(
                                SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                                "text-foreground",
                              )}
                            >
                              {thread.title}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                          No conversations linked to this worktree.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full shrink-0 flex-col items-end gap-2 sm:w-auto">
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={deleteDisabled}
                      onClick={() =>
                        void props.deleteManagedWorktree({
                          workspaceRoot: group.workspaceRoot,
                          worktreePath: worktree.path,
                        })
                      }
                    >
                      Delete
                    </Button>
                    {worktree.linkedThreads.length > 0 ? (
                      <p
                        className={cn(
                          SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                          "max-w-40 text-right",
                        )}
                      >
                        Linked conversations exist. Deleting will ask for confirmation.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </SettingsSection>
      ))}
    </div>
  );
}
