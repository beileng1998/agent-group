import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

const ensuredAgentGroupSkillsDirs = new Set<string>();

export function clearEnsuredAgentGroupSkillsDirsForTests(): void {
  ensuredAgentGroupSkillsDirs.clear();
}

export function agentGroupSkillsDir(agentGroupBaseDir: string): string {
  return nodePath.join(agentGroupBaseDir, "skills");
}

// Creates the portable skills folder on first use so users have a drop-in target.
export async function ensureAgentGroupSkillsDir(agentGroupBaseDir: string): Promise<string> {
  const dir = agentGroupSkillsDir(agentGroupBaseDir);
  if (ensuredAgentGroupSkillsDirs.has(dir)) {
    return dir;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    ensuredAgentGroupSkillsDirs.add(dir);
  } catch {
    // Discovery still works without the folder; reads simply return nothing.
  }
  return dir;
}
