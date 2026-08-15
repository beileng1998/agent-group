import type { ProviderSkillDescriptor } from "@agent-group/contracts";

import type { SkillsCatalogDiscoveryInput } from "./catalogTypes.ts";
import { discoverClaudePluginSkillRoots } from "../claudePluginSkills.ts";
import {
  clearEnsuredAgentGroupSkillsDirsForTests,
  ensureAgentGroupSkillsDir,
} from "./skillDirectories.ts";
import { collectSkillDescriptorsFromRoots, collectSkillsFromRoots } from "./skillDiscovery.ts";
import { skillsCatalogRoots } from "./skillRoots.ts";

const SKILLS_CATALOG_CACHE_TTL_MS = 15_000;
const SKILLS_CATALOG_CACHE_MAX_ENTRIES = 64;

interface SkillsCatalogCacheEntry {
  readonly at: number;
  readonly skills: ReadonlyArray<ProviderSkillDescriptor>;
}

const skillsCatalogCache = new Map<string, SkillsCatalogCacheEntry>();
const skillsCatalogInflight = new Map<string, Promise<ReadonlyArray<ProviderSkillDescriptor>>>();

export function clearSkillsCatalogCacheForTests(): void {
  skillsCatalogCache.clear();
  skillsCatalogInflight.clear();
  clearEnsuredAgentGroupSkillsDirsForTests();
}

export async function discoverSkillsCatalog(
  input: SkillsCatalogDiscoveryInput,
): Promise<ProviderSkillDescriptor[]> {
  const cacheKey = [
    input.cwd?.trim() ?? "",
    input.provider ?? "",
    input.homeDir,
    input.agentGroupBaseDir,
    input.includeDuplicateOrigins ? "all-origins" : "deduped",
  ].join("\u0000");

  if (!input.forceReload) {
    const entry = skillsCatalogCache.get(cacheKey);
    if (entry && Date.now() - entry.at <= SKILLS_CATALOG_CACHE_TTL_MS) {
      return [...entry.skills];
    }
  }

  const inflight = skillsCatalogInflight.get(cacheKey);
  if (inflight) {
    return [...(await inflight)];
  }

  const scan = (async () => {
    await ensureAgentGroupSkillsDir(input.agentGroupBaseDir);
    const roots = [
      ...skillsCatalogRoots(input),
      ...(await discoverClaudePluginSkillRoots({
        homeDir: input.homeDir,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      })),
    ];
    const skills = input.includeDuplicateOrigins
      ? await collectSkillDescriptorsFromRoots(roots)
      : await collectSkillsFromRoots(roots);

    skillsCatalogCache.delete(cacheKey);
    skillsCatalogCache.set(cacheKey, { at: Date.now(), skills });
    while (skillsCatalogCache.size > SKILLS_CATALOG_CACHE_MAX_ENTRIES) {
      const oldestKey = skillsCatalogCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      skillsCatalogCache.delete(oldestKey);
    }
    return skills;
  })();

  skillsCatalogInflight.set(cacheKey, scan);
  try {
    return [...(await scan)];
  } finally {
    skillsCatalogInflight.delete(cacheKey);
  }
}
