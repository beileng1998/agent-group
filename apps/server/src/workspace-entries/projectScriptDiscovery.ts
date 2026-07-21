import fs from "node:fs/promises";
import path from "node:path";

import type {
  ProjectDiscoverScriptsInput,
  ProjectDiscoverScriptsResult,
  ProjectDiscoveredScriptTarget,
} from "@agent-group/contracts";
import {
  expandHomePath,
  IGNORED_DIRECTORY_NAMES,
  isPathInIgnoredDirectory,
  mapWithConcurrency,
  toPosixPath,
} from "./workspaceEntryValues";

const PROJECT_SCRIPT_DISCOVERY_DEFAULT_DEPTH = 2;
const PROJECT_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const PROJECT_PACKAGE_SCAN_MAX_TARGETS = 80;
const PROJECT_PACKAGE_SCAN_READDIR_CONCURRENCY = 16;

type ProjectPackageManager = "bun" | "pnpm" | "yarn" | "npm";

const PROJECT_PACKAGE_MANAGER_LOCKFILES: ReadonlyArray<{
  readonly manager: ProjectPackageManager;
  readonly filenames: readonly string[];
}> = [
  { manager: "bun", filenames: ["bun.lock", "bun.lockb"] },
  { manager: "pnpm", filenames: ["pnpm-lock.yaml"] },
  { manager: "yarn", filenames: ["yarn.lock"] },
  { manager: "npm", filenames: ["package-lock.json", "npm-shrinkwrap.json"] },
];

function normalizeDiscoveryDepth(input: ProjectDiscoverScriptsInput): number {
  const rawDepth = input.depth ?? PROJECT_SCRIPT_DISCOVERY_DEFAULT_DEPTH;
  return Math.max(0, Math.min(3, Math.floor(rawDepth)));
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(packageDir: string): Promise<ProjectPackageManager> {
  for (const candidate of PROJECT_PACKAGE_MANAGER_LOCKFILES) {
    for (const filename of candidate.filenames) {
      if (await pathExists(path.join(packageDir, filename))) {
        return candidate.manager;
      }
    }
  }
  return "npm";
}

function commandForPackageScript(manager: ProjectPackageManager, scriptName: string): string {
  if (manager === "yarn") {
    return `yarn ${scriptName}`;
  }
  return `${manager} run ${scriptName}`;
}

async function collectPackageJsonCandidates(
  cwd: string,
  maxDepth: number,
): Promise<Array<{ absoluteDir: string; relativePath: string }>> {
  const candidates: Array<{ absoluteDir: string; relativePath: string }> = [];
  let pendingDirectories: Array<{ absoluteDir: string; relativePath: string; depth: number }> = [
    { absoluteDir: cwd, relativePath: "", depth: 0 },
  ];

  while (pendingDirectories.length > 0 && candidates.length < PROJECT_PACKAGE_SCAN_MAX_TARGETS) {
    const currentDirectories = pendingDirectories;
    pendingDirectories = [];

    const directoryEntries = await mapWithConcurrency(
      currentDirectories,
      PROJECT_PACKAGE_SCAN_READDIR_CONCURRENCY,
      async (directory) => {
        try {
          const dirents = await fs.readdir(directory.absoluteDir, { withFileTypes: true });
          return { directory, dirents };
        } catch {
          return { directory, dirents: null };
        }
      },
    );

    for (const { directory, dirents } of directoryEntries) {
      if (!dirents) {
        continue;
      }
      if (dirents.some((dirent) => dirent.isFile() && dirent.name === "package.json")) {
        candidates.push({
          absoluteDir: directory.absoluteDir,
          relativePath: directory.relativePath,
        });
        if (candidates.length >= PROJECT_PACKAGE_SCAN_MAX_TARGETS) {
          break;
        }
      }
      if (directory.depth >= maxDepth) {
        continue;
      }
      for (const dirent of dirents.toSorted((left, right) => left.name.localeCompare(right.name))) {
        if (!dirent.isDirectory() || IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
          continue;
        }
        if (dirent.name === "." || dirent.name === "..") {
          continue;
        }
        const childRelativePath = toPosixPath(
          directory.relativePath ? path.join(directory.relativePath, dirent.name) : dirent.name,
        );
        if (isPathInIgnoredDirectory(childRelativePath)) {
          continue;
        }
        pendingDirectories.push({
          absoluteDir: path.join(directory.absoluteDir, dirent.name),
          relativePath: childRelativePath,
          depth: directory.depth + 1,
        });
      }
    }
  }

  return candidates;
}

async function readDiscoveredPackageTarget(input: {
  cwd: string;
  relativePath: string;
}): Promise<ProjectDiscoveredScriptTarget | null> {
  const packageJsonPath = path.join(input.cwd, "package.json");
  const stats = await fs.stat(packageJsonPath).catch(() => null);
  if (!stats?.isFile() || stats.size > PROJECT_PACKAGE_JSON_MAX_BYTES) {
    return null;
  }

  const packageJsonText = await fs.readFile(packageJsonPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const packageRecord = parsed as Record<string, unknown>;
  const rawScripts = packageRecord.scripts;
  if (!rawScripts || typeof rawScripts !== "object" || Array.isArray(rawScripts)) {
    return null;
  }

  const manager = await detectPackageManager(input.cwd);
  const scripts = Object.entries(rawScripts)
    .flatMap(([name, command]) =>
      typeof command === "string" && name.trim().length > 0 && command.trim().length > 0
        ? [{ name: name.trim(), command: commandForPackageScript(manager, name.trim()) }]
        : [],
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
  if (scripts.length === 0) {
    return null;
  }

  const packageName =
    typeof packageRecord.name === "string" && packageRecord.name.trim().length > 0
      ? packageRecord.name.trim()
      : null;

  return {
    cwd: input.cwd,
    relativePath: input.relativePath,
    packageJsonPath,
    ...(packageName ? { packageName } : {}),
    scripts,
  };
}

export async function discoverProjectScripts(
  input: ProjectDiscoverScriptsInput,
): Promise<ProjectDiscoverScriptsResult> {
  const cwd = path.resolve(expandHomePath(input.cwd));
  const maxDepth = normalizeDiscoveryDepth(input);
  const candidates = await collectPackageJsonCandidates(cwd, maxDepth);
  const targets = await mapWithConcurrency(
    candidates,
    PROJECT_PACKAGE_SCAN_READDIR_CONCURRENCY,
    (candidate) =>
      readDiscoveredPackageTarget({
        cwd: candidate.absoluteDir,
        relativePath: candidate.relativePath,
      }),
  );

  return {
    targets: targets
      .filter((target): target is ProjectDiscoveredScriptTarget => target !== null)
      .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}
