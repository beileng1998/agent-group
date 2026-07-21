import type { ResolvedKeybindingsConfig } from "@agent-group/contracts";
import { useMemo } from "react";

import { formatShortcutLabel, shortcutLabelForCommand } from "../keybindings";

export type ChatShortcutLabels = {
  terminal: {
    split: string | null;
    splitDown: string | null;
    new: string | null;
    close: string | null;
    closeWorkspace: string | null;
  };
  diff: string | null;
  model: string;
  traits: string | null;
};

export function useChatShortcutLabels(keybindings: ResolvedKeybindingsConfig): ChatShortcutLabels {
  return useMemo(
    () => ({
      terminal: {
        split:
          shortcutLabelForCommand(keybindings, "terminal.splitRight") ??
          shortcutLabelForCommand(keybindings, "terminal.split"),
        splitDown: shortcutLabelForCommand(keybindings, "terminal.splitDown"),
        new: shortcutLabelForCommand(keybindings, "terminal.new"),
        close: shortcutLabelForCommand(keybindings, "terminal.close"),
        closeWorkspace: shortcutLabelForCommand(keybindings, "terminal.workspace.closeActive"),
      },
      diff: shortcutLabelForCommand(keybindings, "diff.toggle"),
      model:
        shortcutLabelForCommand(keybindings, "modelPicker.toggle") ??
        formatShortcutLabel({
          key: "m",
          metaKey: false,
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
          modKey: true,
        }),
      traits: shortcutLabelForCommand(keybindings, "traitsPicker.toggle"),
    }),
    [keybindings],
  );
}
