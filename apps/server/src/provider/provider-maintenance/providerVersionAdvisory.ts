import type {
  ProviderKind,
  ServerProviderStatus,
  ServerProviderVersionAdvisory,
} from "@agent-group/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  makeManualOnlyProviderMaintenanceCapabilities,
  nonEmptyString,
} from "./providerMaintenanceCapabilities";
import type {
  ProviderLatestVersionSource,
  ProviderMaintenanceCapabilities,
} from "./providerMaintenanceContracts";
import { compareSemverVersions } from "./providerMaintenanceSemver";

const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;
const PROVIDER_UPDATE_ACTION_MESSAGE = "Install the update now or review provider settings.";

const latestVersionCache = new Map<
  string,
  { readonly expiresAt: number; readonly version: string | null }
>();

function deriveVersionAdvisory(input: {
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
}): Pick<ServerProviderVersionAdvisory, "status" | "message"> {
  if (!input.currentVersion || !input.latestVersion) {
    return { status: "unknown", message: null };
  }
  if (compareSemverVersions(input.currentVersion, input.latestVersion) < 0) {
    return {
      status: "behind_latest",
      message: PROVIDER_UPDATE_ACTION_MESSAGE,
    };
  }
  return { status: "current", message: null };
}

export function createProviderVersionAdvisory(input: {
  readonly provider: ProviderKind;
  readonly currentVersion: string | null;
  readonly latestVersion?: string | null;
  readonly checkedAt?: string | null;
  readonly maintenanceCapabilities?: ProviderMaintenanceCapabilities;
}): ServerProviderVersionAdvisory {
  const capabilities =
    input.maintenanceCapabilities ??
    makeManualOnlyProviderMaintenanceCapabilities({ provider: input.provider, packageName: null });
  const latestVersion = input.latestVersion ?? null;
  const advisory = deriveVersionAdvisory({
    currentVersion: input.currentVersion,
    latestVersion,
  });

  return {
    status: advisory.status,
    currentVersion: input.currentVersion,
    latestVersion,
    updateCommand: capabilities.update?.command ?? null,
    canUpdate: capabilities.update !== null,
    checkedAt: input.checkedAt ?? null,
    message: advisory.message,
  };
}

const fetchNpmLatestVersion = Effect.fn("fetchNpmLatestVersion")(function* (packageName: string) {
  return yield* Effect.tryPromise(async () => {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { version?: unknown };
    return nonEmptyString(payload.version);
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

const fetchHomebrewLatestVersion = Effect.fn("fetchHomebrewLatestVersion")(function* (
  source: ProviderLatestVersionSource,
) {
  if (source.kind !== "homebrew" || !source.homebrewKind) {
    return null;
  }
  return yield* Effect.tryPromise(async () => {
    const response = await fetch(
      `https://formulae.brew.sh/api/${source.homebrewKind}/${encodeURIComponent(source.name)}.json`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      version?: unknown;
      versions?: { stable?: unknown };
    };
    return nonEmptyString(
      source.homebrewKind === "cask" ? payload.version : payload.versions?.stable,
    );
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

export const resolveLatestProviderVersion = Effect.fn("resolveLatestProviderVersion")(function* (
  maintenanceCapabilities: ProviderMaintenanceCapabilities,
) {
  const source = maintenanceCapabilities.latestVersionSource;
  if (!source) {
    return null;
  }

  const cacheKey =
    source.kind === "homebrew"
      ? `homebrew:${source.homebrewKind ?? "unknown"}:${source.name}`
      : `npm:${source.name}`;
  const cached = latestVersionCache.get(cacheKey);
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  if (cached && cached.expiresAt > now) {
    return cached.version;
  }

  const version =
    source.kind === "homebrew"
      ? yield* fetchHomebrewLatestVersion(source)
      : yield* fetchNpmLatestVersion(source.name);
  latestVersionCache.set(cacheKey, {
    expiresAt: now + LATEST_VERSION_CACHE_TTL_MS,
    version,
  });
  return version;
});

export const enrichProviderStatusWithVersionAdvisory = Effect.fn(
  "enrichProviderStatusWithVersionAdvisory",
)(function* (
  status: ServerProviderStatus,
  maintenanceCapabilities: ProviderMaintenanceCapabilities,
) {
  if (!status.available || !status.version) {
    return {
      ...status,
      versionAdvisory: createProviderVersionAdvisory({
        provider: status.provider,
        currentVersion: status.version ?? null,
        checkedAt: status.checkedAt,
        maintenanceCapabilities,
      }),
    };
  }

  const latestVersion = yield* resolveLatestProviderVersion(maintenanceCapabilities);
  return {
    ...status,
    versionAdvisory: createProviderVersionAdvisory({
      provider: status.provider,
      currentVersion: status.version,
      latestVersion,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      maintenanceCapabilities,
    }),
  };
});
