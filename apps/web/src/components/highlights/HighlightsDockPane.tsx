import type { HighlightListItem, ProjectId, ThreadId } from "@agent-group/contracts";
import { useEffect, useState } from "react";

import { HighlightsExplorer } from "./HighlightsExplorer";
import type { HighlightScopeState } from "./highlightScope";

export function HighlightsDockPane(props: {
  sessionId: ThreadId;
  projectId: ProjectId;
  onJump: (item: HighlightListItem) => void;
}) {
  const [scopeState, setScopeState] = useState<HighlightScopeState>(() => ({
    level: "session",
    sessionId: props.sessionId,
    projectId: props.projectId,
  }));

  useEffect(() => {
    setScopeState({
      level: "session",
      sessionId: props.sessionId,
      projectId: props.projectId,
    });
  }, [props.projectId, props.sessionId]);

  return (
    <HighlightsExplorer state={scopeState} onStateChange={setScopeState} onJump={props.onJump} />
  );
}
