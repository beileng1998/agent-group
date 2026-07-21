import { KeybindingRule, KeybindingsConfig, type ServerConfigIssue } from "@agent-group/contracts";
import { Schema, SchemaGetter } from "effect";

/**
 * Result of normalizing the raw on-disk keybindings config into a list of entries.
 *
 * `migratedShape: true` marks tolerated non-canonical top-level shapes (empty file,
 * `null`, `{}`, `{"keybindings": [...]}`, or a single rule object) so callers can
 * rewrite the file into the canonical JSON-array form instead of surfacing an error
 * on every startup.
 */
export type RawKeybindingsEntriesResult =
  | {
      readonly _tag: "success";
      readonly entries: ReadonlyArray<unknown>;
      readonly migratedShape: boolean;
    }
  | { readonly _tag: "failure"; readonly detail: string };

function describeJsonValueShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function decodeRawKeybindingsEntries(rawConfig: string): RawKeybindingsEntriesResult {
  if (rawConfig.trim().length === 0) {
    return { _tag: "success", entries: [], migratedShape: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    return { _tag: "failure", detail: `expected JSON array (${String(error)})` };
  }

  if (Array.isArray(parsed)) {
    return { _tag: "success", entries: parsed, migratedShape: false };
  }
  if (parsed === null) {
    return { _tag: "success", entries: [], migratedShape: true };
  }
  if (typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.keybindings)) {
      return { _tag: "success", entries: record.keybindings, migratedShape: true };
    }
    if (Object.keys(record).length === 0) {
      return { _tag: "success", entries: [], migratedShape: true };
    }
    if (typeof record.key === "string" && typeof record.command === "string") {
      return { _tag: "success", entries: [record], migratedShape: true };
    }
  }
  return {
    _tag: "failure",
    detail: `expected JSON array, got ${describeJsonValueShape(parsed)}`,
  };
}

const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);
const PrettyJsonString = SchemaGetter.parseJson<string>().compose(
  SchemaGetter.stringifyJson({ space: 2 }),
);
export const KeybindingsConfigPrettyJson = KeybindingsConfigJson.pipe(
  Schema.encode({
    decode: PrettyJsonString,
    encode: PrettyJsonString,
  }),
);

function trimIssueMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : "Invalid keybindings configuration.";
}

export function malformedConfigIssue(detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.malformed-config",
    message: trimIssueMessage(detail),
  };
}

export function invalidEntryIssue(index: number, detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.invalid-entry",
    index,
    message: trimIssueMessage(detail),
  };
}

const LEGACY_KEYBINDING_COMMAND_ALIASES = {
  "commandPalette.toggle": "sidebar.search",
  "composer.effortPicker.toggle": "traitsPicker.toggle",
  "composer.modelPicker.toggle": "modelPicker.toggle",
  "effortPicker.toggle": "traitsPicker.toggle",
  "reasoningPicker.toggle": "traitsPicker.toggle",
  "thread.previous": "chat.visible.previous",
  "thread.next": "chat.visible.next",
} as const satisfies Record<string, KeybindingRule["command"]>;

// Commands removed without a direct replacement are dropped during startup so
// persisted configs from older releases do not produce validation warnings.
const RETIRED_LEGACY_KEYBINDING_COMMANDS = new Set(["chat.newGemini"]);
const RETIRED_LEGACY_KEYBINDING_COMMAND_PATTERN = /^(?:composer\.)?modelPicker\.jump\.[1-9]$/;
const OUTDATED_RECENT_VIEW_TERMINAL_GUARD = "!terminalFocus";
const RECENT_VIEW_SHORTCUT_BY_COMMAND: Partial<Record<KeybindingRule["command"], string>> = {
  "view.recent.next": "ctrl+tab",
  "view.recent.previous": "ctrl+shift+tab",
};

// New-surface creation commands shipped guarded by a bare `!terminalFocus`. On macOS
// `mod` is Cmd and xterm never forwards a Cmd-chord to the PTY, so that guard silently
// dropped "new chat/terminal" chords whenever the terminal had focus. The relaxed guard
// adds an `|| isMac` escape hatch (see DEFAULT_KEYBINDINGS) so the chord fires on macOS
// regardless of focus while Linux/Windows keep yielding Ctrl-chords to the shell.
const OUTDATED_CREATION_TERMINAL_GUARD = "!terminalFocus";
const RELAXED_CREATION_TERMINAL_GUARD = "!terminalFocus || isMac";
const CREATION_COMMANDS_WITH_TERMINAL_ESCAPE = new Set<KeybindingRule["command"]>([
  "chat.new",
  "chat.newLatestProject",
  "chat.newChat",
  "chat.newLocal",
  "chat.newTerminal",
  "chat.newClaude",
  "chat.newCodex",
  "chat.newCursor",
  "chat.split",
]);

export function readKeybindingEntryCommand(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }

  const command = (entry as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

export function isRetiredLegacyKeybindingCommand(command: string): boolean {
  return (
    RETIRED_LEGACY_KEYBINDING_COMMANDS.has(command) ||
    RETIRED_LEGACY_KEYBINDING_COMMAND_PATTERN.test(command)
  );
}

// Cross-device configs can lag behind command renames; normalize known aliases
// before schema validation so stale synced files do not become warning toasts.
export function normalizeLegacyKeybindingEntry(entry: unknown): {
  readonly entry: unknown;
  readonly migrated: boolean;
} {
  const command = readKeybindingEntryCommand(entry);
  if (typeof command !== "string" || !(command in LEGACY_KEYBINDING_COMMAND_ALIASES)) {
    return { entry, migrated: false };
  }

  // `readKeybindingEntryCommand` only yields a string command for non-null object
  // entries, so the spread target is guaranteed to be an object here.
  return {
    entry: {
      ...(entry as Record<string, unknown>),
      command:
        LEGACY_KEYBINDING_COMMAND_ALIASES[
          command as keyof typeof LEGACY_KEYBINDING_COMMAND_ALIASES
        ],
    },
    migrated: true,
  };
}

// Update exact old recent-view defaults so existing configs gain terminal-focus support
// (drop the `!terminalFocus` guard). Per-rule because it never changes the key, so it
// cannot collide with a sibling entry.
export function migrateOutdatedDefaultKeybindingRule(rule: KeybindingRule): {
  readonly rule: KeybindingRule;
  readonly migrated: boolean;
} {
  const recentViewShortcut = RECENT_VIEW_SHORTCUT_BY_COMMAND[rule.command];
  if (
    recentViewShortcut === undefined ||
    rule.key !== recentViewShortcut ||
    rule.when !== OUTDATED_RECENT_VIEW_TERMINAL_GUARD
  ) {
    return { rule, migrated: false };
  }

  return {
    rule: {
      key: rule.key,
      command: rule.command,
    },
    migrated: true,
  };
}

// Add the `|| isMac` escape hatch to new-surface creation commands still pinned to the
// bare `!terminalFocus` guard, so existing configs gain the macOS terminal-focus fix the
// shipped defaults already carry. Matched on command + exact old guard (not key) so it
// also reaches a creation command the user rebound to a different chord — the guard, not
// the key, is what was too aggressive. Idempotent: once relaxed the guard no longer
// matches the old one.
export function relaxCreationCommandTerminalGuards(rules: readonly KeybindingRule[]): {
  readonly rules: KeybindingRule[];
  readonly migratedCount: number;
} {
  let migratedCount = 0;
  const next = rules.map((rule) => {
    if (
      rule.when !== OUTDATED_CREATION_TERMINAL_GUARD ||
      !CREATION_COMMANDS_WITH_TERMINAL_ESCAPE.has(rule.command)
    ) {
      return rule;
    }
    migratedCount += 1;
    return { ...rule, when: RELAXED_CREATION_TERMINAL_GUARD };
  });
  return { rules: next, migratedCount };
}
