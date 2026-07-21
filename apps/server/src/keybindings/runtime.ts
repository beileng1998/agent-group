import { KeybindingRule, MAX_KEYBINDINGS_COUNT, type ServerConfigIssue } from "@agent-group/contracts";
import {
  Array,
  Cache,
  Cause,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Path,
  Predicate,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config";
import {
  decodeRawKeybindingsEntries,
  invalidEntryIssue,
  isRetiredLegacyKeybindingCommand,
  KeybindingsConfigPrettyJson,
  malformedConfigIssue,
  migrateOutdatedDefaultKeybindingRule,
  normalizeLegacyKeybindingEntry,
  readKeybindingEntryCommand,
  relaxCreationCommandTerminalGuards,
} from "./configMigrations";
import {
  DEFAULT_KEYBINDINGS,
  hasSameShortcutContext,
  isSameKeybindingRule,
  mergeWithDefaultKeybindings,
} from "./defaults";
import { compileResolvedKeybindingsConfig, ResolvedKeybindingFromConfig } from "./parserSchema";
import {
  type KeybindingsChangeEvent,
  KeybindingsConfigError,
  type KeybindingsConfigState,
  type KeybindingsShape,
} from "./serviceContracts";

export const makeKeybindings = Effect.gen(function* () {
  const { keybindingsConfigPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const upsertSemaphore = yield* Semaphore.make(1);
  const resolvedConfigCacheKey = "resolved" as const;
  const changesPubSub = yield* PubSub.unbounded<KeybindingsChangeEvent>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, KeybindingsConfigError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
  const emitChange = (configState: KeybindingsConfigState) =>
    PubSub.publish(changesPubSub, configState).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(keybindingsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: "failed to access keybindings config",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(keybindingsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: "failed to read keybindings config",
          cause,
        }),
    ),
  );

  const loadWritableCustomKeybindingsConfig = Effect.fn(function* (): Effect.fn.Return<
    readonly KeybindingRule[],
    KeybindingsConfigError
  > {
    if (!(yield* readConfigExists)) {
      return [];
    }

    const rawConfig = yield* readRawConfig;
    const decodedEntries = decodeRawKeybindingsEntries(rawConfig);
    if (decodedEntries._tag === "failure") {
      return yield* new KeybindingsConfigError({
        configPath: keybindingsConfigPath,
        detail: decodedEntries.detail,
      });
    }

    return yield* Effect.forEach(decodedEntries.entries, (entry) =>
      Effect.gen(function* () {
        const command = readKeybindingEntryCommand(entry);
        if (command !== null && isRetiredLegacyKeybindingCommand(command)) {
          return null;
        }

        const normalized = normalizeLegacyKeybindingEntry(entry);
        const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(normalized.entry);
        if (decodedRule._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid keybinding entry", {
            path: keybindingsConfigPath,
            entry,
            error: Cause.pretty(decodedRule.cause),
          });
          return null;
        }
        const resolved = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
        if (resolved._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid keybinding entry", {
            path: keybindingsConfigPath,
            entry,
            error: Cause.pretty(resolved.cause),
          });
          return null;
        }
        return decodedRule.value;
      }),
    ).pipe(Effect.map(Array.filter(Predicate.isNotNull)));
  });

  const loadRuntimeCustomKeybindingsConfig = Effect.fn(function* (): Effect.fn.Return<
    {
      readonly keybindings: readonly KeybindingRule[];
      readonly issues: readonly ServerConfigIssue[];
      readonly migratedLegacyCommandCount: number;
      readonly migratedDefaultRuleCount: number;
      readonly migratedConfigShape: boolean;
    },
    KeybindingsConfigError
  > {
    if (!(yield* readConfigExists)) {
      return {
        keybindings: [],
        issues: [],
        migratedLegacyCommandCount: 0,
        migratedDefaultRuleCount: 0,
        migratedConfigShape: false,
      };
    }

    const rawConfig = yield* readRawConfig;
    const decodedEntries = decodeRawKeybindingsEntries(rawConfig);
    if (decodedEntries._tag === "failure") {
      return {
        keybindings: [],
        issues: [malformedConfigIssue(decodedEntries.detail)],
        migratedLegacyCommandCount: 0,
        migratedDefaultRuleCount: 0,
        migratedConfigShape: false,
      };
    }
    if (decodedEntries.migratedShape) {
      yield* Effect.logWarning("migrating keybindings config with non-array top-level shape", {
        path: keybindingsConfigPath,
      });
    }

    const keybindings: KeybindingRule[] = [];
    const issues: ServerConfigIssue[] = [];
    let migratedLegacyCommandCount = 0;
    let migratedDefaultRuleCount = 0;
    for (const [index, entry] of decodedEntries.entries.entries()) {
      const command = readKeybindingEntryCommand(entry);
      if (command !== null && isRetiredLegacyKeybindingCommand(command)) {
        migratedLegacyCommandCount += 1;
        continue;
      }

      const normalized = normalizeLegacyKeybindingEntry(entry);
      if (normalized.migrated) {
        migratedLegacyCommandCount += 1;
      }
      const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(normalized.entry);
      if (decodedRule._tag === "Failure") {
        const detail = Cause.pretty(decodedRule.cause);
        issues.push(invalidEntryIssue(index, detail));
        yield* Effect.logWarning("ignoring invalid keybinding entry", {
          path: keybindingsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }

      const resolvedRule = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
      if (resolvedRule._tag === "Failure") {
        const detail = Cause.pretty(resolvedRule.cause);
        issues.push(invalidEntryIssue(index, detail));
        yield* Effect.logWarning("ignoring invalid keybinding entry", {
          path: keybindingsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }
      const migratedDefaultRule = migrateOutdatedDefaultKeybindingRule(decodedRule.value);
      if (migratedDefaultRule.migrated) {
        migratedDefaultRuleCount += 1;
      }
      keybindings.push(migratedDefaultRule.rule);
    }

    const relaxed = relaxCreationCommandTerminalGuards(keybindings);
    migratedDefaultRuleCount += relaxed.migratedCount;

    return {
      keybindings: relaxed.rules,
      issues,
      migratedLegacyCommandCount,
      migratedDefaultRuleCount,
      migratedConfigShape: decodedEntries.migratedShape,
    };
  });

  const writeConfigAtomically = (rules: readonly KeybindingRule[]) => {
    const tempPath = `${keybindingsConfigPath}.${process.pid}.${Date.now()}.tmp`;

    return Schema.encodeEffect(KeybindingsConfigPrettyJson)(rules).pipe(
      Effect.map((encoded) => `${encoded}\n`),
      Effect.tap(() => fs.makeDirectory(path.dirname(keybindingsConfigPath), { recursive: true })),
      Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fs.rename(tempPath, keybindingsConfigPath)),
      Effect.mapError(
        (cause) =>
          new KeybindingsConfigError({
            configPath: keybindingsConfigPath,
            detail: "failed to write keybindings config",
            cause,
          }),
      ),
    );
  };

  const loadConfigStateFromDisk = loadRuntimeCustomKeybindingsConfig().pipe(
    Effect.map(({ keybindings, issues }) => ({
      keybindings: mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(keybindings)),
      issues,
    })),
  );

  const resolvedConfigCache = yield* Cache.make<
    typeof resolvedConfigCacheKey,
    KeybindingsConfigState,
    KeybindingsConfigError
  >({
    capacity: 1,
    lookup: () => loadConfigStateFromDisk,
  });

  const loadConfigStateFromCacheOrDisk = Cache.get(resolvedConfigCache, resolvedConfigCacheKey);

  const revalidateAndEmit = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      const configState = yield* loadConfigStateFromCacheOrDisk;
      yield* emitChange(configState);
    }),
  );

  const syncDefaultKeybindingsOnStartup = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const configExists = yield* readConfigExists;
      if (!configExists) {
        yield* writeConfigAtomically(DEFAULT_KEYBINDINGS);
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const runtimeConfig = yield* loadRuntimeCustomKeybindingsConfig();
      if (runtimeConfig.issues.length > 0) {
        yield* Effect.logWarning(
          "skipping startup keybindings default sync because config has issues",
          {
            path: keybindingsConfigPath,
            issues: runtimeConfig.issues,
          },
        );
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }
      const customConfig = runtimeConfig.keybindings;
      const existingCommands = new Set(customConfig.map((entry) => entry.command));
      const missingDefaults: KeybindingRule[] = [];
      const shortcutConflictWarnings: Array<{
        defaultCommand: KeybindingRule["command"];
        conflictingCommand: KeybindingRule["command"];
        key: string;
        when: string | null;
      }> = [];
      for (const defaultRule of DEFAULT_KEYBINDINGS) {
        if (existingCommands.has(defaultRule.command)) {
          continue;
        }
        const conflictingEntry = customConfig.find((entry) =>
          hasSameShortcutContext(entry, defaultRule),
        );
        if (conflictingEntry) {
          shortcutConflictWarnings.push({
            defaultCommand: defaultRule.command,
            conflictingCommand: conflictingEntry.command,
            key: defaultRule.key,
            when: defaultRule.when ?? null,
          });
          continue;
        }
        missingDefaults.push(defaultRule);
      }
      for (const conflict of shortcutConflictWarnings) {
        yield* Effect.logWarning("skipping default keybinding due to shortcut conflict", {
          path: keybindingsConfigPath,
          defaultCommand: conflict.defaultCommand,
          conflictingCommand: conflict.conflictingCommand,
          key: conflict.key,
          when: conflict.when,
          reason: "shortcut context already used by existing rule",
        });
      }
      if (missingDefaults.length === 0) {
        if (
          runtimeConfig.migratedLegacyCommandCount > 0 ||
          runtimeConfig.migratedDefaultRuleCount > 0 ||
          runtimeConfig.migratedConfigShape
        ) {
          yield* writeConfigAtomically(customConfig);
        }
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const matchingDefaults = DEFAULT_KEYBINDINGS.filter((defaultRule) =>
        customConfig.some((entry) => isSameKeybindingRule(entry, defaultRule)),
      ).map((rule) => rule.command);
      if (matchingDefaults.length > 0) {
        yield* Effect.logWarning("default keybinding rule already defined in user config", {
          path: keybindingsConfigPath,
          commands: matchingDefaults,
        });
      }

      const nextConfig = [...customConfig, ...missingDefaults];
      const cappedConfig =
        nextConfig.length > MAX_KEYBINDINGS_COUNT
          ? nextConfig.slice(-MAX_KEYBINDINGS_COUNT)
          : nextConfig;
      if (nextConfig.length > MAX_KEYBINDINGS_COUNT) {
        yield* Effect.logWarning("truncating keybindings config to max entries", {
          path: keybindingsConfigPath,
          maxEntries: MAX_KEYBINDINGS_COUNT,
        });
      }

      const migratedKeybindingCount =
        runtimeConfig.migratedLegacyCommandCount + runtimeConfig.migratedDefaultRuleCount;
      if (migratedKeybindingCount > 0) {
        yield* Effect.logInfo("migrated keybinding config entries", {
          path: keybindingsConfigPath,
          count: migratedKeybindingCount,
        });
      }
      yield* writeConfigAtomically(cappedConfig);
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const keybindingsConfigDir = path.dirname(keybindingsConfigPath);
    const keybindingsConfigFile = path.basename(keybindingsConfigPath);
    const keybindingsConfigPathResolved = path.resolve(keybindingsConfigPath);

    yield* fs.makeDirectory(keybindingsConfigDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new KeybindingsConfigError({
            configPath: keybindingsConfigPath,
            detail: "failed to prepare keybindings config directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    yield* Stream.runForEach(fs.watch(keybindingsConfigDir), (event) => {
      const isTargetConfigEvent =
        event.path === keybindingsConfigFile ||
        event.path === keybindingsConfigPath ||
        path.resolve(keybindingsConfigDir, event.path) === keybindingsConfigPathResolved;
      if (!isTargetConfigEvent) {
        return Effect.void;
      }
      return revalidateAndEmitSafely;
    }).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
  });

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(startedRef);
    if (alreadyStarted) {
      return yield* Deferred.await(startedDeferred);
    }

    yield* Ref.set(startedRef, true);
    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* syncDefaultKeybindingsOnStartup;
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      yield* loadConfigStateFromCacheOrDisk;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    syncDefaultKeybindingsOnStartup,
    loadConfigState: loadConfigStateFromCacheOrDisk,
    getSnapshot: loadConfigStateFromCacheOrDisk,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
    upsertKeybindingRule: (rule) =>
      upsertSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const customConfig = yield* loadWritableCustomKeybindingsConfig();
          const nextConfig = [
            ...customConfig.filter((entry) => entry.command !== rule.command),
            rule,
          ];
          const cappedConfig =
            nextConfig.length > MAX_KEYBINDINGS_COUNT
              ? nextConfig.slice(-MAX_KEYBINDINGS_COUNT)
              : nextConfig;
          if (nextConfig.length > MAX_KEYBINDINGS_COUNT) {
            yield* Effect.logWarning("truncating keybindings config to max entries", {
              path: keybindingsConfigPath,
              maxEntries: MAX_KEYBINDINGS_COUNT,
            });
          }
          yield* writeConfigAtomically(cappedConfig);
          const nextResolved = mergeWithDefaultKeybindings(
            compileResolvedKeybindingsConfig(cappedConfig),
          );
          yield* Cache.set(resolvedConfigCache, resolvedConfigCacheKey, {
            keybindings: nextResolved,
            issues: [],
          });
          yield* emitChange({
            keybindings: nextResolved,
            issues: [],
          });
          return nextResolved;
        }),
      ),
  } satisfies KeybindingsShape;
});
