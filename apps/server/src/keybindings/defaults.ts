import {
  type KeybindingRule,
  MAX_KEYBINDINGS_COUNT,
  type ResolvedKeybindingsConfig,
} from "@agent-group/contracts";
import {
  compileResolvedKeybindingsConfig,
  encodeShortcut,
  parseKeybindingShortcut,
} from "./parserSchema";

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" },
  { key: "mod+k", command: "sidebar.search" },
  { key: "mod+shift+o", command: "sidebar.addProject", when: "!terminalFocus" },
  { key: "mod+i", command: "sidebar.importThread", when: "!terminalFocus" },
  { key: "mod+j", command: "terminal.toggle" },
  { key: "mod+d", command: "terminal.split", when: "terminalFocus" },
  { key: "mod+shift+arrowright", command: "terminal.splitRight", when: "terminalFocus" },
  { key: "mod+shift+arrowleft", command: "terminal.splitLeft", when: "terminalFocus" },
  { key: "mod+shift+arrowdown", command: "terminal.splitDown", when: "terminalFocus" },
  { key: "mod+shift+arrowup", command: "terminal.splitUp", when: "terminalFocus" },
  // Reserve Cmd/Ctrl+T for the terminal workspace's "new tab" action while focused.
  { key: "mod+t", command: "terminal.new", when: "terminalFocus" },
  { key: "mod+w", command: "terminal.close", when: "terminalFocus" },
  { key: "mod+shift+j", command: "terminal.workspace.newFullWidth" },
  { key: "mod+w", command: "terminal.workspace.closeActive", when: "terminalWorkspaceOpen" },
  { key: "mod+1", command: "terminal.workspace.terminal", when: "terminalWorkspaceOpen" },
  { key: "mod+2", command: "terminal.workspace.chat", when: "terminalWorkspaceOpen" },
  { key: "mod+shift+b", command: "browser.toggle", when: "!terminalFocus" },
  { key: "mod+d", command: "diff.toggle", when: "!terminalFocus" },
  // Cmd-only instead of mod so Ctrl+L remains available to shells on non-macOS.
  { key: "cmd+l", command: "composer.focus.toggle", when: "!terminalFocus" },
  { key: "mod+shift+m", command: "modelPicker.toggle", when: "!terminalFocus" },
  // Cycle models within the active provider (favorites first, then remaining list).
  { key: "alt+]", command: "model.next", when: "!terminalFocus" },
  { key: "alt+[", command: "model.previous", when: "!terminalFocus" },
  { key: "mod+shift+e", command: "traitsPicker.toggle", when: "!terminalFocus" },
  { key: "mod+shift+u", command: "settings.usage", when: "!terminalFocus" },
  // New thread (chat.new) is the primary create action; it falls back to the most
  // recent project when no project is active.
  //
  // These new-surface chords use `!terminalFocus || isMac`: on macOS `mod` is Cmd and
  // xterm never forwards a Cmd-chord to the PTY, so the bare `!terminalFocus` guard just
  // dropped the chord while the terminal had focus (you couldn't open a new chat/terminal
  // from the terminal). The `|| isMac` escape hatch fires them on macOS regardless of
  // focus, while Linux/Windows keep `!terminalFocus` so Ctrl-chords still reach the shell.
  { key: "mod+n", command: "chat.new", when: "!terminalFocus || isMac" },
  { key: "mod+shift+n", command: "chat.newLatestProject", when: "!terminalFocus || isMac" },
  { key: "mod+alt+n", command: "chat.newChat", when: "!terminalFocus || isMac" },
  { key: "mod+shift+t", command: "chat.newTerminal", when: "!terminalFocus || isMac" },
  { key: "mod+alt+c", command: "chat.newClaude", when: "!terminalFocus || isMac" },
  { key: "mod+alt+x", command: "chat.newCodex", when: "!terminalFocus || isMac" },
  { key: "mod+alt+r", command: "chat.newCursor", when: "!terminalFocus || isMac" },
  { key: "mod+\\", command: "chat.split", when: "!terminalFocus || isMac" },
  // Recent-view switcher (Ctrl+Tab) is an installed-app feature only: Electron and
  // standalone PWA windows have no tab strip, so the chord reaches the page. It remains
  // app-level even with terminal focus; the web route captures it before xterm input.
  { key: "ctrl+tab", command: "view.recent.next" },
  { key: "ctrl+shift+tab", command: "view.recent.previous" },
  { key: "mod+1", command: "thread.jump.1", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+2", command: "thread.jump.2", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+3", command: "thread.jump.3", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+4", command: "thread.jump.4", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+5", command: "thread.jump.5", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+6", command: "thread.jump.6", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+7", command: "thread.jump.7", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+8", command: "thread.jump.8", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+9", command: "thread.jump.9", when: "!terminalFocus && !terminalWorkspaceOpen" },
  { key: "mod+shift+]", command: "chat.visible.next", when: "!terminalFocus" },
  { key: "mod+shift+[", command: "chat.visible.previous", when: "!terminalFocus" },
  { key: "mod+o", command: "editor.openFavorite" },
];

const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

export function isSameKeybindingRule(left: KeybindingRule, right: KeybindingRule): boolean {
  return (
    left.command === right.command &&
    left.key === right.key &&
    (left.when ?? undefined) === (right.when ?? undefined)
  );
}

function keybindingShortcutContext(rule: KeybindingRule): string | null {
  const parsed = parseKeybindingShortcut(rule.key);
  if (!parsed) return null;
  const encoded = encodeShortcut(parsed);
  if (!encoded) return null;
  return `${encoded}\u0000${rule.when ?? ""}`;
}

export function hasSameShortcutContext(left: KeybindingRule, right: KeybindingRule): boolean {
  const leftContext = keybindingShortcutContext(left);
  const rightContext = keybindingShortcutContext(right);
  if (!leftContext || !rightContext) return false;
  return leftContext === rightContext;
}

export function mergeWithDefaultKeybindings(
  custom: ResolvedKeybindingsConfig,
): ResolvedKeybindingsConfig {
  if (custom.length === 0) {
    return [...DEFAULT_RESOLVED_KEYBINDINGS];
  }

  const overriddenCommands = new Set(custom.map((binding) => binding.command));
  const retainedDefaults = DEFAULT_RESOLVED_KEYBINDINGS.filter(
    (binding) => !overriddenCommands.has(binding.command),
  );
  const merged = [...retainedDefaults, ...custom];

  if (merged.length <= MAX_KEYBINDINGS_COUNT) {
    return merged;
  }

  // Keep the latest rules when the config exceeds max size; later rules have higher precedence.
  return merged.slice(-MAX_KEYBINDINGS_COUNT);
}
