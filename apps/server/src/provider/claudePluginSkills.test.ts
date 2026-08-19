import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pathIsWithin } from "./claudePluginSkills.ts";
import { clearSkillsCatalogCacheForTests, discoverSkillsCatalog } from "./skillsCatalog.ts";

let root: string;
let homeDir: string;
let agentGroupBaseDir: string;

function pluginPath(marketplace: string, plugin: string, version: string): string {
  return path.join(homeDir, ".claude", "plugins", "cache", marketplace, plugin, version);
}

async function writeSkill(skillDir: string, name: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n`,
  );
}

async function writeManifest(plugins: Record<string, unknown>): Promise<void> {
  const manifestPath = path.join(homeDir, ".claude", "plugins", "installed_plugins.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ version: 2, plugins }));
}

beforeEach(() => {
  clearSkillsCatalogCacheForTests();
  root = mkdtempSync(path.join(os.tmpdir(), "agent-group-claude-plugins-"));
  homeDir = path.join(root, "home");
  agentGroupBaseDir = path.join(homeDir, ".agent-group");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Claude plugin skill discovery", () => {
  it("discovers only the registered cache version with Claude's namespace", async () => {
    const active = pluginPath("official", "workflow-kit", "2.0.0");
    const stale = pluginPath("official", "workflow-kit", "1.0.0");
    await writeSkill(path.join(active, "skills", "deliver"), "deliver");
    await writeSkill(path.join(stale, "skills", "stale"), "stale");
    await writeManifest({
      "workflow-kit@official": [{ scope: "user", installPath: active }],
    });

    const skills = await discoverSkillsCatalog({ homeDir, agentGroupBaseDir });

    expect(skills.map((skill) => skill.name)).toContain("workflow-kit:deliver");
    expect(skills.some((skill) => skill.name.includes("stale"))).toBe(false);
  });

  it("uses the highest-precedence install that applies to the cwd", async () => {
    const projectDir = path.join(root, "repo");
    const cwd = path.join(projectDir, "packages", "web");
    const projectInstall = pluginPath("official", "review-kit", "2.0.0");
    const userInstall = pluginPath("official", "review-kit", "1.0.0");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(projectInstall, "skills", "project-review"), "project-review");
    await writeSkill(path.join(userInstall, "skills", "user-review"), "user-review");
    await writeManifest({
      "review-kit@official": [
        { scope: "user", installPath: userInstall },
        { scope: "project", projectPath: projectDir, installPath: projectInstall },
      ],
    });

    const skills = await discoverSkillsCatalog({ cwd, homeDir, agentGroupBaseDir });
    const names = skills.map((skill) => skill.name);

    expect(names).toContain("review-kit:project-review");
    expect(names).not.toContain("review-kit:user-review");
  });

  it("rejects installs outside Claude's cache and cross-drive containment", async () => {
    const outsideInstall = path.join(root, "outside-plugin");
    await writeSkill(path.join(outsideInstall, "skills", "unsafe"), "unsafe");
    await writeManifest({
      "unsafe@local": [{ scope: "user", installPath: outsideInstall }],
    });

    const skills = await discoverSkillsCatalog({ homeDir, agentGroupBaseDir });

    expect(skills.some((skill) => skill.name.includes("unsafe"))).toBe(false);
    expect(pathIsWithin("C:\\plugins", "C:\\plugins\\safe", path.win32)).toBe(true);
    expect(pathIsWithin("C:\\plugins", "D:\\plugins\\unsafe", path.win32)).toBe(false);
  });
});
