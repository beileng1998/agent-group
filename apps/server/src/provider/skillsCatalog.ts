// Generic Agent Skill discovery and unified cross-provider catalog facade.
// Keep this import path stable for provider adapters and discovery services.

export type {
  SkillRoot,
  SkillsCatalogDiscoveryInput,
  SkillsCatalogOrigin,
  SkillsCatalogRootInput,
} from "./skills-catalog/catalogTypes.ts";
export { parseSkillFrontmatter, readSkillDescriptor } from "./skills-catalog/skillFrontmatter.ts";
export {
  ancestorsFromDeepest,
  collectSkillMarkdownPaths,
  collectSkillsFromRoots,
} from "./skills-catalog/skillDiscovery.ts";
export {
  ensureAgentGroupSkillsDir,
  agentGroupSkillsDir,
} from "./skills-catalog/skillDirectories.ts";
export { providerNativeSkillRoots, skillsCatalogRoots } from "./skills-catalog/skillRoots.ts";
export {
  filterDisabledSkills,
  mergeSkillsIntoCatalog,
  skillNameKey,
} from "./skills-catalog/skillProjection.ts";
export {
  clearSkillsCatalogCacheForTests,
  discoverSkillsCatalog,
} from "./skills-catalog/skillsCatalogCache.ts";
