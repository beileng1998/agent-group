// FILE: SidebarThreadJumpLabels.ts
// Purpose: Resolve stable numbered-thread shortcut labels for sidebar rows.
// Layer: Web sidebar presentation logic

import type { ResolvedKeybindingsConfig, ThreadId } from "@agent-group/contracts";
import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../../keybindings";

export const EMPTY_THREAD_JUMP_LABELS = new Map<ThreadId, string>();

export function threadJumpLabelMapsEqual(
  left: ReadonlyMap<ThreadId, string>,
  right: ReadonlyMap<ThreadId, string>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [threadId, label] of left) {
    if (right.get(threadId) !== label) return false;
  }
  return true;
}

export function buildThreadJumpLabelMap(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByThreadId: ReadonlyMap<
    ThreadId,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<ThreadId, string> {
  if (input.threadJumpCommandByThreadId.size === 0) return EMPTY_THREAD_JUMP_LABELS;

  const shortcutLabelOptions = {
    platform: input.platform,
    context: { terminalFocus: false, terminalOpen: input.terminalOpen },
  } as const;
  const mapping = new Map<ThreadId, string>();
  for (const [threadId, command] of input.threadJumpCommandByThreadId) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) mapping.set(threadId, label);
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}
