import type { ProviderSkillDescriptor } from "@agent-group/contracts";

export function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

// Provider-native discovery results win on name conflicts; catalog entries fill the gaps.
export function mergeSkillsIntoCatalog(input: {
  readonly native: ReadonlyArray<ProviderSkillDescriptor>;
  readonly catalog: ReadonlyArray<ProviderSkillDescriptor>;
}): ProviderSkillDescriptor[] {
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of [...input.native, ...input.catalog]) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export function filterDisabledSkills(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  disabledNames: ReadonlyArray<string>,
): ProviderSkillDescriptor[] {
  if (disabledNames.length === 0) {
    return [...skills];
  }
  const disabled = new Set(disabledNames.map((name) => skillNameKey(name)));
  return skills.filter((skill) => !disabled.has(skillNameKey(skill.name)));
}
