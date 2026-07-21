import type { ProjectId } from "@agent-group/contracts";

import { useGroupSettingsStore } from "~/groupSettingsStore";
import { SettingsIcon } from "~/lib/icons";
import { Button } from "./ui/button";

/** Compatibility surface for persisted right-dock tabs from older builds. */
export default function AgentGroupSettingsPane(props: { groupId: ProjectId }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/35">
        <SettingsIcon className="size-4" />
      </div>
      <div>
        <p className="text-sm font-medium">Group settings moved</p>
        <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
          Group settings now open independently from the Session dock.
        </p>
      </div>
      <Button size="sm" onClick={() => useGroupSettingsStore.getState().open(props.groupId)}>
        Open Group settings
      </Button>
    </div>
  );
}
