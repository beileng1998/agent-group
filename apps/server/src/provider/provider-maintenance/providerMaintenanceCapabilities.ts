import type { ProviderKind } from "@agent-group/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type {
  PackageManagedProviderMaintenanceDefinition,
  ProviderInstallSource,
  ProviderLatestVersionSource,
  ProviderMaintenanceCapabilities,
  ProviderMaintenanceCapabilityResolutionOptions,
} from "./providerMaintenanceContracts";

const WINDOWS_EXECUTABLE_EXTENSIONS = ["", ".exe", ".cmd", ".bat"] as const;

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeCommandPath(commandPath: string): string {
  return commandPath.replaceAll("\\", "/").toLowerCase();
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function makeProviderMaintenanceCapabilities(input: {
  readonly provider: ProviderKind;
  readonly packageName: string | null;
  readonly latestVersionSource?: ProviderLatestVersionSource | null;
  readonly updateExecutable: string | null;
  readonly updateArgs: ReadonlyArray<string>;
  readonly updateLockKey: string | null;
  readonly updatePathPrepend?: string | null;
}): ProviderMaintenanceCapabilities {
  const update =
    input.updateExecutable === null || input.updateLockKey === null
      ? null
      : {
          command: [input.updateExecutable, ...input.updateArgs].join(" "),
          executable: input.updateExecutable,
          args: input.updateArgs,
          lockKey: input.updateLockKey,
          ...(nonEmptyString(input.updatePathPrepend)
            ? { pathPrepend: nonEmptyString(input.updatePathPrepend)! }
            : {}),
        };
  return {
    provider: input.provider,
    packageName: input.packageName,
    latestVersionSource:
      input.latestVersionSource ??
      (input.packageName ? { kind: "npm", name: input.packageName } : null),
    update,
  };
}

export function makeManualOnlyProviderMaintenanceCapabilities(input: {
  readonly provider: ProviderKind;
  readonly packageName: string | null;
}): ProviderMaintenanceCapabilities {
  return makeProviderMaintenanceCapabilities({
    provider: input.provider,
    packageName: input.packageName,
    updateExecutable: null,
    updateArgs: [],
    updateLockKey: null,
  });
}

function makeNpmGlobalProviderMaintenanceCapabilities(
  definition: PackageManagedProviderMaintenanceDefinition,
  pathPrepend?: string | null,
): ProviderMaintenanceCapabilities {
  if (!definition.npmPackageName) {
    return makeManualOnlyProviderMaintenanceCapabilities({
      provider: definition.provider,
      packageName: null,
    });
  }
  return makeProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: definition.npmPackageName,
    updateExecutable: "npm",
    updateArgs: ["install", "-g", `${definition.npmPackageName}@latest`],
    updateLockKey: "npm-global",
    ...(pathPrepend === undefined ? {} : { updatePathPrepend: pathPrepend }),
  });
}

function makeBunGlobalProviderMaintenanceCapabilities(
  definition: PackageManagedProviderMaintenanceDefinition,
  pathPrepend?: string | null,
): ProviderMaintenanceCapabilities {
  if (!definition.npmPackageName) {
    return makeManualOnlyProviderMaintenanceCapabilities({
      provider: definition.provider,
      packageName: null,
    });
  }
  return makeProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: definition.npmPackageName,
    updateExecutable: "bun",
    updateArgs: ["i", "-g", `${definition.npmPackageName}@latest`],
    updateLockKey: "bun-global",
    ...(pathPrepend === undefined ? {} : { updatePathPrepend: pathPrepend }),
  });
}

function makePnpmGlobalProviderMaintenanceCapabilities(
  definition: PackageManagedProviderMaintenanceDefinition,
  pathPrepend?: string | null,
): ProviderMaintenanceCapabilities {
  if (!definition.npmPackageName) {
    return makeManualOnlyProviderMaintenanceCapabilities({
      provider: definition.provider,
      packageName: null,
    });
  }
  return makeProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: definition.npmPackageName,
    updateExecutable: "pnpm",
    updateArgs: ["add", "-g", `${definition.npmPackageName}@latest`],
    updateLockKey: "pnpm-global",
    ...(pathPrepend === undefined ? {} : { updatePathPrepend: pathPrepend }),
  });
}

function makeHomebrewProviderMaintenanceCapabilities(
  definition: PackageManagedProviderMaintenanceDefinition,
  pathPrepend?: string | null,
): ProviderMaintenanceCapabilities {
  if (!definition.homebrew) {
    return makeManualOnlyProviderMaintenanceCapabilities({
      provider: definition.provider,
      packageName: definition.npmPackageName,
    });
  }

  return makeProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: null,
    latestVersionSource: resolveLatestVersionSourceForInstallSource(definition, "homebrew"),
    updateExecutable: "brew",
    updateArgs:
      definition.homebrew.kind === "cask"
        ? ["upgrade", "--cask", definition.homebrew.name]
        : ["upgrade", definition.homebrew.name],
    updateLockKey: "homebrew",
    ...(pathPrepend === undefined ? {} : { updatePathPrepend: pathPrepend }),
  });
}

function resolveLatestVersionSourceForInstallSource(
  definition: PackageManagedProviderMaintenanceDefinition,
  installSource: ProviderInstallSource,
): ProviderLatestVersionSource | null {
  if (definition.latestVersionSource) {
    return definition.latestVersionSource;
  }
  if (installSource === "homebrew" && definition.homebrew) {
    return {
      kind: "homebrew",
      name: definition.homebrew.name,
      homebrewKind: definition.homebrew.kind,
    };
  }
  return definition.npmPackageName ? { kind: "npm", name: definition.npmPackageName } : null;
}

function makeNativeProviderMaintenanceCapabilities(
  definition: PackageManagedProviderMaintenanceDefinition,
  installSource: ProviderInstallSource,
  executable?: string | null,
  pathPrepend?: string | null,
): ProviderMaintenanceCapabilities | null {
  if (!definition.nativeUpdate) {
    return null;
  }

  return makeProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: installSource === "homebrew" ? null : definition.npmPackageName,
    // Prefer explicit upstream metadata for channels like third-party Homebrew taps,
    // then fall back to the package manager channel when its public API is usable.
    latestVersionSource: resolveLatestVersionSourceForInstallSource(definition, installSource),
    updateExecutable: executable ?? definition.nativeUpdate.executable,
    updateArgs: definition.nativeUpdate.args(installSource),
    updateLockKey: definition.nativeUpdate.lockKey,
    ...(pathPrepend === undefined ? {} : { updatePathPrepend: pathPrepend }),
  });
}

function detectInstallSource(
  definition: PackageManagedProviderMaintenanceDefinition,
  commandPath: string,
): ProviderInstallSource {
  if (definition.nativeUpdate?.isCommandPath?.(commandPath)) {
    return "native";
  }
  if (isBunGlobalCommandPath(commandPath)) {
    return "bun";
  }
  if (isPnpmGlobalCommandPath(commandPath)) {
    return "pnpm";
  }
  if (isNpmGlobalCommandPath(commandPath)) {
    return "npm";
  }
  if (isHomebrewCommandPath(commandPath)) {
    return "homebrew";
  }
  return "unknown";
}

function makeProviderMaintenanceForInstallSource(input: {
  readonly definition: PackageManagedProviderMaintenanceDefinition;
  readonly installSource: ProviderInstallSource;
  readonly executable?: string | null;
  readonly pathPrepend?: string | null;
}): ProviderMaintenanceCapabilities {
  const { definition, installSource, executable, pathPrepend } = input;
  if (
    definition.nativeUpdate?.strategy === "always" &&
    !definition.nativeUpdate.excludedInstallSources?.includes(installSource)
  ) {
    return (
      makeNativeProviderMaintenanceCapabilities(
        definition,
        installSource,
        executable,
        pathPrepend,
      ) ??
      makeManualOnlyProviderMaintenanceCapabilities({
        provider: definition.provider,
        packageName: definition.npmPackageName,
      })
    );
  }
  if (installSource === "native") {
    return (
      makeNativeProviderMaintenanceCapabilities(
        definition,
        installSource,
        executable,
        pathPrepend,
      ) ??
      makeManualOnlyProviderMaintenanceCapabilities({
        provider: definition.provider,
        packageName: definition.npmPackageName,
      })
    );
  }
  if (installSource === "bun") {
    return makeBunGlobalProviderMaintenanceCapabilities(definition, pathPrepend);
  }
  if (installSource === "pnpm") {
    return makePnpmGlobalProviderMaintenanceCapabilities(definition, pathPrepend);
  }
  if (installSource === "npm") {
    return makeNpmGlobalProviderMaintenanceCapabilities(definition, pathPrepend);
  }
  if (installSource === "homebrew") {
    return makeHomebrewProviderMaintenanceCapabilities(definition, pathPrepend);
  }
  return makeManualOnlyProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: definition.npmPackageName,
  });
}

function isBunGlobalCommandPath(commandPath: string): boolean {
  return normalizeCommandPath(commandPath).includes("/.bun/bin/");
}

function isPnpmGlobalCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.includes("/.local/share/pnpm/") ||
    normalized.includes("/library/pnpm/") ||
    normalized.includes("/local/share/pnpm/") ||
    normalized.includes("/appdata/local/pnpm/") ||
    normalized.includes("/pnpm/global/")
  );
}

function isNpmGlobalCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.includes("/node_modules/.bin/") ||
    normalized.includes("/lib/node_modules/") ||
    normalized.includes("/npm/node_modules/")
  );
}

function isHomebrewCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.includes("/opt/homebrew/caskroom/") ||
    normalized.includes("/usr/local/caskroom/") ||
    normalized.includes("/opt/homebrew/cellar/") ||
    normalized.includes("/usr/local/cellar/") ||
    normalized.includes("/homebrew/cellar/") ||
    normalized.startsWith("/opt/homebrew/bin/") ||
    normalized.startsWith("/usr/local/bin/")
  );
}

export function resolvePackageManagedProviderMaintenance(
  definition: PackageManagedProviderMaintenanceDefinition,
  options?: ProviderMaintenanceCapabilityResolutionOptions,
): ProviderMaintenanceCapabilities {
  const binaryPath = nonEmptyString(options?.binaryPath);
  if (!binaryPath) {
    return makeManualOnlyProviderMaintenanceCapabilities({
      provider: definition.provider,
      packageName: definition.npmPackageName,
    });
  }

  const commandPaths = [options?.realCommandPath, binaryPath]
    .map(nonEmptyString)
    .filter((value): value is string => value !== null);

  for (const commandPath of commandPaths) {
    const installSource = detectInstallSource(definition, commandPath);
    if (installSource !== "unknown") {
      return makeProviderMaintenanceForInstallSource({
        definition,
        installSource,
        executable: binaryPath,
        ...(options?.commandDirectory === undefined
          ? {}
          : { pathPrepend: options.commandDirectory }),
      });
    }
  }

  if (!hasPathSeparator(binaryPath)) {
    return makeProviderMaintenanceForInstallSource({
      definition,
      installSource: "unknown",
      executable: binaryPath,
      ...(options?.commandDirectory === undefined ? {} : { pathPrepend: options.commandDirectory }),
    });
  }

  return makeManualOnlyProviderMaintenanceCapabilities({
    provider: definition.provider,
    packageName: definition.npmPackageName,
  });
}

export const resolveProviderMaintenanceCapabilitiesEffect = Effect.fn(
  "resolveProviderMaintenanceCapabilitiesEffect",
)(function* (
  definition: PackageManagedProviderMaintenanceDefinition,
  options?: ProviderMaintenanceCapabilityResolutionOptions,
) {
  const binaryPath = nonEmptyString(options?.binaryPath) ?? definition.binaryName;
  if (hasPathSeparator(binaryPath)) {
    return resolvePackageManagedProviderMaintenance(definition, options);
  }

  const pathEntries = (options?.env?.PATH ?? process.env.PATH ?? "")
    .split(options?.platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const fileSystem = yield* FileSystem.FileSystem;
  const executableCandidates =
    options?.platform === "win32"
      ? WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${binaryPath}${extension}`)
      : [binaryPath];
  for (const entry of pathEntries) {
    for (const executableCandidate of executableCandidates) {
      const candidate = `${entry}/${executableCandidate}`;
      const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        continue;
      }
      const realCommandPath = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.catch(() => Effect.succeed(candidate)));
      return resolvePackageManagedProviderMaintenance(definition, {
        ...options,
        binaryPath,
        realCommandPath,
        commandDirectory: entry,
      });
    }
  }

  return resolvePackageManagedProviderMaintenance(definition, {
    ...options,
    binaryPath,
  });
});
