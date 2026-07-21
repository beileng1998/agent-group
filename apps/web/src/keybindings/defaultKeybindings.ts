import {
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
} from "@agent-group/contracts";

function commandShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function whenAnd(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "and", left, right };
}

function whenOr(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "or", left, right };
}

const whenNotTerminalFocus = whenNot(whenIdentifier("terminalFocus"));
const whenThreadJumpAvailable = whenAnd(
  whenNotTerminalFocus,
  whenNot(whenIdentifier("terminalWorkspaceOpen")),
);
// New-surface creation chords (new chat/terminal/provider chat/split) bind to `mod`,
// which is Cmd on macOS. xterm never forwards a Cmd-chord to the PTY, so a bare
// `!terminalFocus` guard silently dropped these chords whenever the terminal had focus
// — the chord did nothing instead of creating anything. `|| isMac` lets them fire from
// the terminal on macOS while still yielding the chord to the shell on Linux/Windows,
// where `mod` is Ctrl and keys like Ctrl+N are real shell input that must pass through.
const whenCreationAllowed = whenOr(whenNotTerminalFocus, whenIdentifier("isMac"));

export const DEFAULT_SHORTCUT_FALLBACKS: ResolvedKeybindingsConfig = [
  {
    command: "sidebar.addProject",
    shortcut: commandShortcut("o", { shiftKey: true }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "sidebar.importThread",
    shortcut: commandShortcut("i"),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "chat.new",
    shortcut: commandShortcut("n"),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newLatestProject",
    shortcut: commandShortcut("n", { shiftKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newClaude",
    shortcut: commandShortcut("c", { altKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newChat",
    shortcut: commandShortcut("n", { altKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newTerminal",
    shortcut: commandShortcut("t", { shiftKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newCodex",
    shortcut: commandShortcut("x", { altKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.newCursor",
    shortcut: commandShortcut("r", { altKey: true }),
    whenAst: whenCreationAllowed,
  },
  {
    command: "chat.split",
    shortcut: commandShortcut("\\"),
    whenAst: whenCreationAllowed,
  },
  // Installed-app only (Electron / standalone PWA). Browsers reserve Ctrl+Tab and
  // Ctrl+Shift+Tab for tab switching and won't deliver them to the page, so the
  // recent-view switcher does not open in a normal browser tab. Uses literal Ctrl
  // (not mod) on purpose so it stays Ctrl+Tab on macOS too, matching Arc/Helium.
  // This intentionally ignores terminal focus; the chat route captures the chord
  // before xterm can pass it through to the shell.
  {
    command: "view.recent.next",
    shortcut: commandShortcut("tab", { ctrlKey: true, modKey: false }),
  },
  {
    command: "view.recent.previous",
    shortcut: commandShortcut("tab", { ctrlKey: true, shiftKey: true, modKey: false }),
  },
  {
    command: "modelPicker.toggle",
    shortcut: commandShortcut("m", { shiftKey: true }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "model.next",
    shortcut: commandShortcut("]", { altKey: true, modKey: false }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "model.previous",
    shortcut: commandShortcut("[", { altKey: true, modKey: false }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "traitsPicker.toggle",
    shortcut: commandShortcut("e", { shiftKey: true }),
    whenAst: whenNotTerminalFocus,
  },
  // Cmd-only instead of mod so Ctrl+L remains available to shells on non-macOS.
  {
    command: "composer.focus.toggle",
    shortcut: commandShortcut("l", { metaKey: true, modKey: false }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "settings.usage",
    shortcut: commandShortcut("u", { shiftKey: true }),
    whenAst: whenNotTerminalFocus,
  },
  {
    command: "thread.jump.1",
    shortcut: commandShortcut("1"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.2",
    shortcut: commandShortcut("2"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.3",
    shortcut: commandShortcut("3"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.4",
    shortcut: commandShortcut("4"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.5",
    shortcut: commandShortcut("5"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.6",
    shortcut: commandShortcut("6"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.7",
    shortcut: commandShortcut("7"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.8",
    shortcut: commandShortcut("8"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "thread.jump.9",
    shortcut: commandShortcut("9"),
    whenAst: whenThreadJumpAvailable,
  },
  {
    command: "terminal.workspace.newFullWidth",
    shortcut: commandShortcut("j", { shiftKey: true }),
  },
  {
    command: "terminal.workspace.closeActive",
    shortcut: commandShortcut("w"),
    whenAst: whenIdentifier("terminalWorkspaceOpen"),
  },
  {
    command: "terminal.workspace.terminal",
    shortcut: commandShortcut("1"),
    whenAst: whenIdentifier("terminalWorkspaceOpen"),
  },
  {
    command: "terminal.workspace.chat",
    shortcut: commandShortcut("2"),
    whenAst: whenIdentifier("terminalWorkspaceOpen"),
  },
];
