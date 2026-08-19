// FILE: claudePluginSkills.ts
// Purpose: Resolves active Claude plugin skill roots from Claude's install registry.
// Layer: Server provider discovery helper

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { SkillRoot } from "./skills-catalog/catalogTypes.ts";

interface ClaudePluginInstall {
  readonly installPath: string;
  readonly scope: "user" | "project" | "local" | "managed";
  readonly projectPath?: string;
}

interface ClaudeInstalledPlugin {
  readonly pluginId: string;
  readonly install: ClaudePluginInstall;
}

const SCOPE_PRECEDENCE = {
  managed: 0,
  local: 1,
  project: 2,
  user: 3,
} as const satisfies Record<ClaudePluginInstall["scope"], number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInstall(value: unknown): ClaudePluginInstall | null {
  if (!isRecord(value)) return null;
  const { installPath, projectPath, scope } = value;
  if (
    typeof installPath !== "string" ||
    installPath.trim().length === 0 ||
    !nodePath.isAbsolute(installPath) ||
    (scope !== "user" && scope !== "project" && scope !== "local" && scope !== "managed")
  ) {
    return null;
  }
  return {
    installPath,
    scope,
    ...(typeof projectPath === "string" && projectPath.trim() ? { projectPath } : {}),
  };
}

function parseInstalledPlugins(value: unknown): ClaudeInstalledPlugin[] {
  if (!isRecord(value) || !isRecord(value.plugins)) return [];
  return Object.entries(value.plugins)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([rawPluginId, rawInstalls]) => {
      const pluginId = rawPluginId.trim();
      if (!pluginId.includes("@") || !Array.isArray(rawInstalls)) return [];
      return rawInstalls
        .map(parseInstall)
        .filter((install): install is ClaudePluginInstall => install !== null)
        .toSorted(
          (left, right) =>
            SCOPE_PRECEDENCE[left.scope] - SCOPE_PRECEDENCE[right.scope] ||
            [left.projectPath ?? "", left.installPath]
              .join("\u0000")
              .localeCompare([right.projectPath ?? "", right.installPath].join("\u0000")),
        )
        .map((install) => ({ pluginId, install }));
    });
}

type PathContainmentApi = Pick<typeof nodePath, "isAbsolute" | "relative" | "sep">;

export function pathIsWithin(
  parentPath: string,
  childPath: string,
  pathApi: PathContainmentApi = nodePath,
): boolean {
  const relative = pathApi.relative(parentPath, childPath);
  return (
    relative === "" ||
    (!pathApi.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`))
  );
}

async function canonicalPath(path: string): Promise<string | null> {
  try {
    return await fs.realpath(path);
  } catch {
    return null;
  }
}

async function installAppliesToCwd(
  install: ClaudePluginInstall,
  cwd: string | null,
): Promise<boolean> {
  if (install.scope === "user" || install.scope === "managed") return true;
  if (!cwd || !install.projectPath || !nodePath.isAbsolute(install.projectPath)) return false;
  const [projectPath, cwdPath] = await Promise.all([
    canonicalPath(install.projectPath),
    canonicalPath(cwd),
  ]);
  return Boolean(projectPath && cwdPath && pathIsWithin(projectPath, cwdPath));
}

function pluginNamespace(pluginId: string): string | null {
  const separator = pluginId.indexOf("@");
  const namespace = separator > 0 ? pluginId.slice(0, separator).trim() : "";
  return namespace || null;
}

export async function discoverClaudePluginSkillRoots(input: {
  readonly homeDir: string;
  readonly cwd?: string | null;
}): Promise<SkillRoot[]> {
  const pluginsDir = nodePath.join(input.homeDir, ".claude", "plugins");
  const [manifestRaw, cacheRoot] = await Promise.all([
    fs.readFile(nodePath.join(pluginsDir, "installed_plugins.json"), "utf8").catch(() => null),
    canonicalPath(nodePath.join(pluginsDir, "cache")),
  ]);
  if (!manifestRaw || !cacheRoot) return [];

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    return [];
  }

  const roots: SkillRoot[] = [];
  const selectedPluginIds = new Set<string>();
  const cwd = input.cwd?.trim() || null;
  for (const { pluginId, install } of parseInstalledPlugins(manifest)) {
    if (selectedPluginIds.has(pluginId) || !(await installAppliesToCwd(install, cwd))) continue;
    const namespace = pluginNamespace(pluginId);
    if (!namespace) continue;

    // Claude selects one applicable install per plugin id. Do not fall through
    // to an older cached version if that selected registration is invalid.
    selectedPluginIds.add(pluginId);
    const installPath = await canonicalPath(install.installPath);
    if (!installPath || !pathIsWithin(cacheRoot, installPath)) continue;
    const skillsPath = await canonicalPath(nodePath.join(installPath, "skills"));
    if (!skillsPath || !pathIsWithin(installPath, skillsPath)) continue;
    try {
      if (!(await fs.stat(skillsPath)).isDirectory()) continue;
    } catch {
      continue;
    }
    roots.push({ path: skillsPath, scope: "claude", namespace, followSymlinks: false });
  }
  return roots;
}
