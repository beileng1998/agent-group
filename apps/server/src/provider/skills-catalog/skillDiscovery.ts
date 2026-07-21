import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderSkillDescriptor } from "@agent-group/contracts";

import type { SkillRoot } from "./catalogTypes.ts";
import { readSkillDescriptor } from "./skillFrontmatter.ts";
import { skillNameKey } from "./skillProjection.ts";

export function ancestorsFromDeepest(cwd: string): string[] {
  const resolved = nodePath.resolve(cwd);
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.push(current);
    const parent = nodePath.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}

async function readdirOrEmpty(path: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isWalkableSkillDirectory(
  parentPath: string,
  dirent: import("node:fs").Dirent,
): Promise<boolean> {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableMarkdownFile(
  parentPath: string,
  dirent: import("node:fs").Dirent,
): Promise<boolean> {
  if (!dirent.name.toLowerCase().endsWith(".md") || dirent.name.toLowerCase() === "skill.md") {
    return false;
  }
  if (dirent.isFile()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isFile();
  } catch {
    return false;
  }
}

// Skills may be nested one namespace deep. Subdirectories are visited
// concurrently but flattened in sorted name order to keep dedupe deterministic.
export async function collectSkillMarkdownPaths(
  rootPath: string,
  options?: { readonly includeMarkdownFiles?: boolean },
): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const skillPath = nodePath.join(dir, "SKILL.md");
    try {
      const stat = await fs.stat(skillPath);
      if (stat.isFile()) {
        return [skillPath];
      }
    } catch {
      // Keep walking; this directory may be a namespace rather than a skill.
    }

    if (depth >= 2) {
      return [];
    }

    const dirents = await readdirOrEmpty(dir);
    const directMarkdownFiles =
      depth === 0 && options?.includeMarkdownFiles
        ? (
            await Promise.all(
              dirents.map(async (dirent) => ({
                name: dirent.name,
                isMarkdownFile: await isReadableMarkdownFile(dir, dirent),
              })),
            )
          )
            .filter((entry) => entry.isMarkdownFile)
            .map((entry) => nodePath.join(dir, entry.name))
            .sort()
        : [];
    const subdirNames = (
      await Promise.all(
        dirents.map(async (dirent) => ({
          name: dirent.name,
          isDirectory: await isWalkableSkillDirectory(dir, dirent),
        })),
      )
    )
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name)
      .sort();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(nodePath.join(dir, name), depth + 1)),
    );
    return [...directMarkdownFiles, ...nested.flat()];
  }

  return visit(rootPath, 0);
}

export async function collectSkillDescriptorsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const skillsPerRoot = await Promise.all(
    roots.map(async (root) => {
      const skillPaths = await collectSkillMarkdownPaths(
        root.path,
        root.includeMarkdownFiles ? { includeMarkdownFiles: true } : undefined,
      );
      const descriptors = await Promise.all(
        skillPaths.map((skillPath) => readSkillDescriptor({ skillPath, scope: root.scope })),
      );
      return descriptors.filter((skill) => skill !== null);
    }),
  );
  return skillsPerRoot.flat();
}

// Scans all roots concurrently, then dedupes by name in root order so earlier
// roots keep precedence. Within a root, SKILL.md path order is preserved.
export async function collectSkillsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const allSkills = await collectSkillDescriptorsFromRoots(roots);
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of allSkills) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}
