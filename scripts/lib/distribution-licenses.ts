// FILE: distribution-licenses.ts
// Purpose: Stage project and dependency license files for desktop distributions.
// Layer: Release/build helper

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string | { readonly type?: string };
  readonly licenses?: ReadonlyArray<{ readonly type?: string }>;
  readonly repository?: string | { readonly url?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

interface DependencyPackage {
  readonly manifest: PackageManifest;
  readonly root: string;
}

export interface DistributionLicenseResult {
  readonly packageCount: number;
  readonly packagesWithoutLicenseFiles: ReadonlyArray<string>;
}

const LICENSE_FILE_PATTERN = /^(?:licen[cs]es?|copying|notice|copyright)(?:[._-].*)?$/i;

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function dependencyNames(manifest: PackageManifest): ReadonlyArray<string> {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

function discoverWorkspacePackages(repoRoot: string): ReadonlyMap<string, string> {
  const packages = new Map<string, string>();
  for (const parent of ["apps", "packages"]) {
    const parentPath = join(repoRoot, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = join(parentPath, entry.name);
      const manifestPath = join(packageRoot, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readManifest(manifestPath);
      if (manifest.name) packages.set(manifest.name, packageRoot);
    }
  }
  return packages;
}

function resolveDependencyRoot(
  name: string,
  fromDirectory: string,
  workspacePackages: ReadonlyMap<string, string>,
): string | null {
  const workspaceRoot = workspacePackages.get(name);
  if (workspaceRoot) return realpathSync(workspaceRoot);

  let current = resolve(fromDirectory);
  const packageSegments = name.split("/");
  while (true) {
    const candidate = join(current, "node_modules", ...packageSegments);
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function collectProductionPackages(repoRoot: string): ReadonlyArray<DependencyPackage> {
  const workspacePackages = discoverWorkspacePackages(repoRoot);
  const workspaceRoots = new Set([...workspacePackages.values()].map((path) => realpathSync(path)));
  const entryManifests = [
    "apps/desktop/package.json",
    "apps/server/package.json",
    "apps/web/package.json",
  ];
  const queue: Array<{ readonly name: string; readonly fromDirectory: string }> = [];
  for (const relativeManifestPath of entryManifests) {
    const manifestPath = join(repoRoot, relativeManifestPath);
    const manifest = readManifest(manifestPath);
    for (const name of dependencyNames(manifest)) {
      queue.push({ name, fromDirectory: dirname(manifestPath) });
    }
  }

  const visitedRoots = new Set<string>();
  const packages: DependencyPackage[] = [];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const packageRoot = resolveDependencyRoot(next.name, next.fromDirectory, workspacePackages);
    if (!packageRoot || visitedRoots.has(packageRoot)) continue;
    visitedRoots.add(packageRoot);

    const manifest = readManifest(join(packageRoot, "package.json"));
    for (const name of dependencyNames(manifest)) {
      queue.push({ name, fromDirectory: packageRoot });
    }
    if (!workspaceRoots.has(packageRoot)) packages.push({ manifest, root: packageRoot });
  }

  return packages.sort((left, right) => {
    const leftId = `${left.manifest.name ?? "unknown"}@${left.manifest.version ?? "unknown"}`;
    const rightId = `${right.manifest.name ?? "unknown"}@${right.manifest.version ?? "unknown"}`;
    return leftId.localeCompare(rightId);
  });
}

function declaredLicense(manifest: PackageManifest): string {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  const legacy = manifest.licenses?.map((entry) => entry.type).filter(Boolean);
  return legacy?.length ? legacy.join(" OR ") : "Not declared";
}

function repositoryUrl(manifest: PackageManifest): string | null {
  if (typeof manifest.repository === "string") return manifest.repository;
  return manifest.repository?.url ?? null;
}

function licenseFiles(packageRoot: string): ReadonlyArray<string> {
  const candidates: string[] = [];
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name)) {
      candidates.push(join(packageRoot, entry.name));
    }
  }
  return candidates.sort();
}

function safePackageDirectory(name: string, version: string): string {
  return `${name}@${version}`.replace(/^@/, "").replace(/[^a-z0-9._-]+/gi, "__");
}

export function stageDistributionLicenses(input: {
  readonly repoRoot: string;
  readonly destinationDirectory: string;
}): DistributionLicenseResult {
  const legalDirectory = input.destinationDirectory;
  const thirdPartyDirectory = join(legalDirectory, "third-party");
  mkdirSync(thirdPartyDirectory, { recursive: true });

  copyFileSync(join(input.repoRoot, "LICENSE"), join(legalDirectory, "LICENSE.txt"));
  copyFileSync(join(input.repoRoot, "NOTICE.md"), join(legalDirectory, "NOTICE.txt"));
  copyFileSync(
    join(input.repoRoot, "THIRD_PARTY_NOTICES.md"),
    join(legalDirectory, "THIRD_PARTY_NOTICES.md"),
  );

  const packages = collectProductionPackages(input.repoRoot);
  const inventory: string[] = [
    "Agent Group Third-Party Software Inventory",
    "",
    "Generated from the installed production dependency graph.",
    "License files referenced below are bundled beside this inventory.",
    "",
  ];
  const packagesWithoutLicenseFiles: string[] = [];
  const usedDirectories = new Set<string>();

  for (const dependency of packages) {
    const name = dependency.manifest.name ?? "unknown-package";
    const version = dependency.manifest.version ?? "unknown-version";
    const id = `${name}@${version}`;
    let directoryName = safePackageDirectory(name, version);
    let collisionIndex = 2;
    while (usedDirectories.has(directoryName)) {
      directoryName = `${safePackageDirectory(name, version)}-${collisionIndex}`;
      collisionIndex += 1;
    }
    usedDirectories.add(directoryName);

    const files = licenseFiles(dependency.root);
    const destination = join(thirdPartyDirectory, directoryName);
    if (files.length > 0) mkdirSync(destination, { recursive: true });

    inventory.push(`Package: ${id}`, `Declared license: ${declaredLicense(dependency.manifest)}`);
    const repository = repositoryUrl(dependency.manifest);
    if (repository) inventory.push(`Source: ${repository}`);
    if (files.length === 0) {
      inventory.push("License files: none published with the installed package");
      packagesWithoutLicenseFiles.push(id);
    } else {
      inventory.push("License files:");
      for (const source of files) {
        const sourceRelativePath = relative(dependency.root, source).replace(/[\\/]/g, "__");
        const destinationPath = join(destination, sourceRelativePath);
        copyFileSync(source, destinationPath);
        inventory.push(`- third-party/${directoryName}/${sourceRelativePath}`);
      }
    }
    inventory.push("");
  }

  writeFileSync(join(legalDirectory, "THIRD_PARTY_NOTICES.txt"), `${inventory.join("\n")}\n`);
  return { packageCount: packages.length, packagesWithoutLicenseFiles };
}
