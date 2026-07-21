// FILE: sidechatSelectionTarget.ts
// Purpose: Resolve the Side composer targeted by transcript selection actions.
// Layer: Web dock utility

import type { ThreadId } from "@agent-group/contracts";

import { resolveActivePane, type RightDockThreadState } from "../rightDockStore.logic";

export function resolveVisibleSidechatTargetThreadId(state: RightDockThreadState): ThreadId | null {
  if (!state.open) {
    return null;
  }
  const activePane = resolveActivePane(state);
  return activePane?.kind === "sidechat" ? activePane.threadId : null;
}
