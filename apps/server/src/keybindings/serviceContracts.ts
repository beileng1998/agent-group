import {
  type KeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerConfigIssue,
} from "@agent-group/contracts";
import { Effect, Schema, ServiceMap, Stream } from "effect";

export class KeybindingsConfigError extends Schema.TaggedErrorClass<KeybindingsConfigError>()(
  "KeybindingsConfigParseError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Unable to parse keybindings config at ${this.configPath}: ${this.detail}`;
  }
}

export interface KeybindingsConfigState {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

export interface KeybindingsChangeEvent {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

/**
 * KeybindingsShape - Service API for keybinding configuration operations.
 */
export interface KeybindingsShape {
  /**
   * Start the keybindings runtime and attach file watching.
   *
   * Safe to call multiple times. The first successful call establishes the
   * runtime; later calls await the same startup.
   */
  readonly start: Effect.Effect<void, KeybindingsConfigError>;

  /**
   * Await keybindings runtime readiness.
   *
   * Readiness means the config directory exists, the watcher is attached, the
   * startup sync has completed, and the current snapshot has been loaded.
   */
  readonly ready: Effect.Effect<void, KeybindingsConfigError>;

  /**
   * Ensure the on-disk keybindings file exists and includes all default
   * commands so newly-added defaults are backfilled on startup.
   */
  readonly syncDefaultKeybindingsOnStartup: Effect.Effect<void, KeybindingsConfigError>;

  /**
   * Load runtime keybindings state along with non-fatal configuration issues.
   */
  readonly loadConfigState: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

  /**
   * Read the latest keybindings snapshot from cache/disk.
   */
  readonly getSnapshot: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

  /**
   * Stream of keybindings config change events.
   */
  readonly streamChanges: Stream.Stream<KeybindingsChangeEvent>;

  /**
   * Upsert a keybinding rule and persist the resulting configuration.
   *
   * Writes config atomically and enforces the max rule count by truncating
   * oldest entries when needed.
   */
  readonly upsertKeybindingRule: (
    rule: KeybindingRule,
  ) => Effect.Effect<ResolvedKeybindingsConfig, KeybindingsConfigError>;
}

/**
 * Keybindings - Service tag for keybinding configuration operations.
 */
export class Keybindings extends ServiceMap.Service<Keybindings, KeybindingsShape>()(
  "agent-group/keybindings",
) {}
