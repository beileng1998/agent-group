import { XIcon } from "~/lib/icons";
import { Button } from "./ui/button";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { Input } from "./ui/input";

export function AgentGroupCreateForm(props: {
  open: boolean;
  busy: boolean;
  groupName: string;
  folderPath: string;
  onGroupNameChange: (value: string) => void;
  onFolderPathChange: (value: string) => void;
  onChooseFolder: () => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <DisclosureRegion open={props.open} className="shrink-0">
      <form
        className="mx-2 mb-2 space-y-2 rounded-lg border border-border/70 bg-background/35 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onCreate();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">New group</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel new group"
            onClick={props.onClose}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
        <Input
          value={props.groupName}
          onChange={(event) => props.onGroupNameChange(event.target.value)}
          placeholder="Group name (optional)"
          aria-label="Group name"
          autoFocus
        />
        <Input
          value={props.folderPath}
          onChange={(event) => props.onFolderPathChange(event.target.value)}
          placeholder="Folder path"
          aria-label="Folder path"
        />
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="flex-1"
            disabled={props.busy}
            onClick={props.onChooseFolder}
          >
            Choose folder
          </Button>
          <Button
            type="submit"
            size="xs"
            className="flex-1"
            disabled={props.busy || props.folderPath.trim().length === 0}
          >
            {props.busy ? "Creating…" : "Create group"}
          </Button>
        </div>
      </form>
    </DisclosureRegion>
  );
}
