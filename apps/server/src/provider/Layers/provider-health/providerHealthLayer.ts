import type {
  ProviderKind,
  ServerProviderStatus,
  ServerProviderUpdateState,
  ServerSettings,
} from "@agent-group/contracts";
import { ServerProviderUpdateError } from "@agent-group/contracts";
import {
  Cache,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Scope,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ServerConfig } from "../../../config";
import { ServerSettingsService } from "../../../serverSettings";
import { makeProviderMaintenanceCommandCoordinator } from "../../providerMaintenanceCommandCoordinator";
import { enrichProviderStatusWithVersionAdvisory } from "../../providerMaintenance";
import { ProviderHealth, type ProviderHealthShape } from "../../Services/ProviderHealth";
import {
  orderProviderStatuses,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "../../providerStatusCache";
import { checkAntigravityProviderStatus, makeCheckCursorProviderStatus } from "./acpProviderProbes";
import { makeCheckClaudeProviderStatus } from "./claudeProviderProbe";
import { makeCheckCodexProviderStatus } from "./codexProviderProbe";
import { probeClaudeSubscription } from "./providerAuthParsing";
import {
  ANTIGRAVITY_PROVIDER,
  CLAUDE_AGENT_PROVIDER,
  CODEX_PROVIDER,
  CURSOR_PROVIDER,
  DROID_PROVIDER,
  GROK_PROVIDER,
  KILO_PROVIDER,
  OPENCODE_PROVIDER,
  PI_PROVIDER,
  PROVIDERS,
  PROVIDER_UPDATE_TIMEOUT_MS,
  type ProviderStatuses,
} from "./providerHealthConstants";
import { makeProviderMaintenanceCapabilitiesResolver } from "./providerMaintenanceResolver";
import {
  isDisabledProviderStatusOverlay,
  isProviderEnabledForSettings,
  mergeProviderStatusUpdates,
  projectProviderStatusesForSettings,
  providerStatusesEqual,
  stabilizeProviderStatusesAgainstTransientTimeouts,
  suppressProviderVersionAdvisory,
} from "./providerStatusProjection";
import {
  checkPiProviderStatus,
  makeCheckDroidProviderStatus,
  makeCheckGrokProviderStatus,
  makeCheckKiloProviderStatus,
  makeCheckOpenCodeProviderStatus,
} from "./simpleProviderProbes";
import { makeProviderUpdater } from "./providerUpdateRuntime";

export function makeProviderHealthLive(options?: { readonly providerUpdateTimeoutMs?: number }) {
  const providerUpdateTimeoutMs = options?.providerUpdateTimeoutMs ?? PROVIDER_UPDATE_TIMEOUT_MS;
  return Layer.effect(
    ProviderHealth,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const changesPubSub = yield* Effect.acquireRelease(
        PubSub.unbounded<ProviderStatuses>(),
        PubSub.shutdown,
      );
      const refreshScope = yield* Scope.make("sequential");
      yield* Effect.addFinalizer(() => Scope.close(refreshScope, Exit.void));

      const cachePathByProvider = new Map(
        PROVIDERS.map(
          (provider) =>
            [
              provider,
              resolveProviderStatusCachePath({ stateDir: serverConfig.stateDir, provider }),
            ] as const,
        ),
      );
      const cachedStatuses: ProviderStatuses = yield* Effect.forEach(
        PROVIDERS,
        (provider) =>
          readProviderStatusCache(cachePathByProvider.get(provider)!).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
          ),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((statuses) =>
          orderProviderStatuses(
            statuses.filter(
              (status): status is ServerProviderStatus =>
                status !== undefined && !isDisabledProviderStatusOverlay(status),
            ),
          ),
        ),
      );

      const statusesRef = yield* Ref.make<ProviderStatuses>(cachedStatuses);
      const updateStatesRef = yield* Ref.make<ReadonlyMap<ProviderKind, ServerProviderUpdateState>>(
        new Map(),
      );
      const refreshFiberRef = yield* Ref.make<Fiber.Fiber<ProviderStatuses, never> | null>(null);
      const commandCoordinator = yield* makeProviderMaintenanceCommandCoordinator({
        makeAlreadyRunningError: (provider) =>
          new ServerProviderUpdateError({
            provider: provider as ProviderKind,
            reason: "An update is already running for this provider.",
          }),
      });
      const claudeSubscriptionCache = yield* Cache.make({
        capacity: 1,
        timeToLive: Duration.minutes(5),
        lookup: (_: "claude") => probeClaudeSubscription(),
      });
      const resolveClaudeSubscription = Cache.get(claudeSubscriptionCache, "claude").pipe(
        Effect.map((probe) => probe?.subscriptionType),
      );
      const getProviderMaintenanceCapabilities = makeProviderMaintenanceCapabilitiesResolver({
        fileSystem,
        serverSettings,
      });

      const applyVolatileProviderState = Effect.fn("applyVolatileProviderState")(function* (
        status: ServerProviderStatus,
      ) {
        const updateState = (yield* Ref.get(updateStatesRef)).get(status.provider);
        if (!updateState) {
          const { updateState: _updateState, ...statusWithoutUpdateState } = status;
          return statusWithoutUpdateState;
        }
        return { ...status, updateState };
      });
      const projectStatusesForCurrentSettings = Effect.fn(
        "projectProviderStatusesForCurrentSettings",
      )(function* (statuses: ReadonlyArray<ServerProviderStatus>) {
        return yield* serverSettings.getSettings.pipe(
          Effect.map((settings) => projectProviderStatusesForSettings(statuses, settings)),
          Effect.catch(() => Effect.succeed(statuses)),
          Effect.flatMap((projected) =>
            Effect.forEach(projected, applyVolatileProviderState, { concurrency: "unbounded" }),
          ),
        );
      });
      const publishProjectedStatuses = Effect.fn("publishProjectedProviderStatuses")(function* () {
        const projected = yield* Ref.get(statusesRef).pipe(
          Effect.flatMap(projectStatusesForCurrentSettings),
        );
        yield* PubSub.publish(changesPubSub, projected);
        return projected;
      });
      const setProviderUpdateState = Effect.fn("setProviderUpdateState")(function* (
        provider: ProviderKind,
        state: ServerProviderUpdateState | null,
      ) {
        yield* Ref.update(updateStatesRef, (previous) => {
          const next = new Map(previous);
          if (!state || state.status === "idle") next.delete(provider);
          else next.set(provider, state);
          return next;
        });
        return yield* publishProjectedStatuses();
      });

      const enrichStatuses = Effect.fn("enrichProviderStatuses")(function* (
        statuses: ReadonlyArray<ServerProviderStatus>,
      ) {
        const settings = yield* serverSettings.ready.pipe(
          Effect.flatMap(() => serverSettings.getSettings),
          Effect.catch(() => Effect.succeed(null)),
        );
        if (settings?.enableProviderUpdateChecks === false) {
          return yield* Effect.forEach(
            statuses.map(suppressProviderVersionAdvisory),
            applyVolatileProviderState,
            { concurrency: "unbounded" },
          );
        }
        const enriched = yield* Effect.forEach(
          statuses,
          (status) =>
            getProviderMaintenanceCapabilities(status.provider).pipe(
              Effect.flatMap((capabilities) =>
                enrichProviderStatusWithVersionAdvisory(status, capabilities),
              ),
              Effect.catch(() =>
                Effect.succeed({
                  ...status,
                  versionAdvisory: {
                    status: "unknown" as const,
                    currentVersion: status.version ?? null,
                    latestVersion: null,
                    updateCommand: null,
                    canUpdate: false,
                    checkedAt: status.checkedAt,
                    message: null,
                  },
                }),
              ),
            ),
          { concurrency: "unbounded" },
        );
        return yield* Effect.forEach(enriched, applyVolatileProviderState, {
          concurrency: "unbounded",
        });
      });

      const checkProviderWhenEnabled = <R>(
        settings: ServerSettings,
        provider: ProviderKind,
        check: Effect.Effect<ServerProviderStatus, never, R>,
      ): Effect.Effect<Option.Option<ServerProviderStatus>, never, R> =>
        isProviderEnabledForSettings(provider, settings)
          ? check.pipe(Effect.map(Option.some))
          : Effect.succeed(Option.none());

      const loadProviderStatuses = serverSettings.ready.pipe(
        Effect.flatMap(() => serverSettings.getSettings),
        Effect.flatMap((settings) =>
          Effect.all(
            [
              checkProviderWhenEnabled(
                settings,
                CODEX_PROVIDER,
                makeCheckCodexProviderStatus(
                  settings.providers.codex.binaryPath,
                  settings.providers.codex.homePath,
                ),
              ),
              checkProviderWhenEnabled(
                settings,
                CLAUDE_AGENT_PROVIDER,
                makeCheckClaudeProviderStatus(
                  resolveClaudeSubscription,
                  settings.providers.claudeAgent.binaryPath,
                  serverConfig.homeDir,
                ),
              ),
              checkProviderWhenEnabled(
                settings,
                CURSOR_PROVIDER,
                makeCheckCursorProviderStatus(settings.providers.cursor.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                ANTIGRAVITY_PROVIDER,
                checkAntigravityProviderStatus(settings.providers.antigravity.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                GROK_PROVIDER,
                makeCheckGrokProviderStatus(settings.providers.grok.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                DROID_PROVIDER,
                makeCheckDroidProviderStatus(settings.providers.droid.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                KILO_PROVIDER,
                makeCheckKiloProviderStatus(settings.providers.kilo.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                OPENCODE_PROVIDER,
                makeCheckOpenCodeProviderStatus(settings.providers.opencode.binaryPath),
              ),
              checkProviderWhenEnabled(
                settings,
                PI_PROVIDER,
                checkPiProviderStatus(
                  settings.providers.pi.agentDir,
                  settings.providers.pi.binaryPath,
                ),
              ),
            ],
            { concurrency: "unbounded" },
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.map((statuses) =>
          orderProviderStatuses(
            statuses.flatMap((status) => (Option.isSome(status) ? [status.value] : [])),
          ),
        ),
        Effect.flatMap(enrichStatuses),
      );

      const persistStatuses = (statuses: ProviderStatuses) =>
        Effect.forEach(
          statuses,
          (status) => {
            const { updateState: _updateState, ...statusToPersist } = status;
            return writeProviderStatusCache({
              filePath: cachePathByProvider.get(status.provider)!,
              provider: statusToPersist,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.tapError(Effect.logError),
              Effect.ignore,
            );
          },
          { concurrency: "unbounded", discard: true },
        );

      const refreshNow = Effect.gen(function* () {
        yield* Cache.invalidate(claudeSubscriptionCache, "claude");
        const loadedStatuses = yield* loadProviderStatuses;
        const previousRawStatuses = yield* Ref.get(statusesRef);
        const previousStatuses = yield* projectStatusesForCurrentSettings(previousRawStatuses);
        const stabilized = stabilizeProviderStatusesAgainstTransientTimeouts(
          previousRawStatuses,
          loadedStatuses,
        );
        const nextRawStatuses = mergeProviderStatusUpdates(previousRawStatuses, stabilized);
        const nextStatuses = yield* projectStatusesForCurrentSettings(nextRawStatuses);
        yield* Ref.set(statusesRef, nextRawStatuses);
        if (providerStatusesEqual(previousStatuses, nextStatuses)) return nextStatuses;
        yield* persistStatuses(nextRawStatuses);
        yield* PubSub.publish(changesPubSub, nextStatuses);
        return nextStatuses;
      });

      const ensureRefreshFiber: Effect.Effect<Fiber.Fiber<ProviderStatuses, never>> = Effect.gen(
        function* () {
          const inFlight = yield* Ref.get(refreshFiberRef);
          if (inFlight) return inFlight;
          const refreshFiber = yield* Effect.gen(function* () {
            const refreshExit = yield* Effect.exit(refreshNow);
            if (Exit.isSuccess(refreshExit)) return refreshExit.value;
            return yield* Ref.get(statusesRef).pipe(
              Effect.flatMap(projectStatusesForCurrentSettings),
            );
          }).pipe(Effect.ensuring(Ref.set(refreshFiberRef, null)), Effect.forkIn(refreshScope));
          yield* Ref.set(refreshFiberRef, refreshFiber);
          return refreshFiber;
        },
      );
      yield* serverSettings.streamChanges.pipe(
        Stream.runForEach(() => publishProjectedStatuses().pipe(Effect.asVoid)),
        Effect.forkIn(refreshScope),
      );

      const refresh: Effect.Effect<ProviderStatuses> = ensureRefreshFiber.pipe(
        Effect.flatMap(Fiber.join),
      );
      const updateProvider = makeProviderUpdater({
        providerUpdateTimeoutMs,
        spawner,
        serverSettings,
        getProviderMaintenanceCapabilities,
        setProviderUpdateState,
        refreshNow,
        commandCoordinator,
      });
      return {
        getStatuses: Ref.get(statusesRef).pipe(Effect.flatMap(projectStatusesForCurrentSettings)),
        refresh,
        updateProvider,
        get streamChanges() {
          return Stream.fromPubSub(changesPubSub);
        },
      } satisfies ProviderHealthShape;
    }),
  );
}

export const ProviderHealthLive = makeProviderHealthLive();
