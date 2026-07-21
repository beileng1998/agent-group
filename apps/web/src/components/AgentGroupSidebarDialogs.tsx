import type { Project, SidebarThreadSummary } from "~/types";
import { RenameDialog } from "./RenameDialog";

export function AgentGroupSidebarDialogs(props: {
  renamingGroup: Project | null;
  renamingSession: SidebarThreadSummary | null;
  onCloseGroupRename: () => void;
  onCloseSessionRename: () => void;
  onRenameGroup: (group: Project, title: string) => Promise<void>;
  onRenameSession: (session: SidebarThreadSummary, title: string) => Promise<void>;
}) {
  return (
    <>
      <RenameDialog
        open={props.renamingGroup !== null}
        title="Rename group"
        description="This name is shared wherever the group is opened."
        initialValue={props.renamingGroup?.remoteName || props.renamingGroup?.name || ""}
        onOpenChange={(open) => {
          if (!open) props.onCloseGroupRename();
        }}
        onSave={async (title) => {
          if (props.renamingGroup) await props.onRenameGroup(props.renamingGroup, title);
        }}
      />

      <RenameDialog
        open={props.renamingSession !== null}
        title="Rename session"
        description="Use a short name that describes this line of work."
        initialValue={props.renamingSession?.title ?? ""}
        onOpenChange={(open) => {
          if (!open) props.onCloseSessionRename();
        }}
        onSave={async (title) => {
          if (props.renamingSession) await props.onRenameSession(props.renamingSession, title);
        }}
      />
    </>
  );
}
