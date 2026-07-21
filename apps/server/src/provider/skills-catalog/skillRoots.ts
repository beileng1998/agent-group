import * as nodePath from "node:path";

import type { ProviderKind } from "@agent-group/contracts";

import type {
  SkillRoot,
  SkillsCatalogDiscoveryInput,
  SkillsCatalogRootInput,
} from "./catalogTypes.ts";
import { ancestorsFromDeepest } from "./skillDiscovery.ts";
import { agentGroupSkillsDir } from "./skillDirectories.ts";

const HOME_ORIGIN_ORDER = [
  "agent-group",
  "codex",
  "claude",
  "cursor",
  "grok",
  "factory",
  "kilo",
  "opencode",
  "pi",
  "agents",
] as const;

type SkillsHomeOrigin = (typeof HOME_ORIGIN_ORDER)[number];

interface SkillOriginRootSpec {
  readonly homeRoots: (input: SkillsCatalogDiscoveryInput) => string[];
  readonly projectRootNames: readonly string[];
}

const SKILL_ORIGIN_ROOTS = {
  "agent-group": {
    homeRoots: (input) => [agentGroupSkillsDir(input.agentGroupBaseDir)],
    projectRootNames: [".agent-group"],
  },
  codex: {
    // Keep Agent Group's existing Codex-local root. Official Codex discovery uses
    // `.agents/skills`, which is represented separately by the shared origin.
    homeRoots: (input) => [nodePath.join(input.homeDir, ".codex", "skills")],
    projectRootNames: [".codex"],
  },
  claude: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".claude", "skills")],
    projectRootNames: [".claude"],
  },
  cursor: {
    homeRoots: (input) => [
      nodePath.join(input.homeDir, ".cursor", "skills-cursor"),
      nodePath.join(input.homeDir, ".cursor", "skills"),
    ],
    projectRootNames: [".cursor"],
  },
  grok: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".grok", "skills")],
    projectRootNames: [".grok"],
  },
  factory: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".factory", "skills")],
    projectRootNames: [".factory"],
  },
  kilo: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".kilo", "skills")],
    projectRootNames: [".kilo"],
  },
  opencode: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".config", "opencode", "skills")],
    projectRootNames: [".opencode"],
  },
  pi: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".pi", "agent", "skills")],
    projectRootNames: [".pi"],
  },
  agents: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".agents", "skills")],
    projectRootNames: [".agents"],
  },
} as const satisfies Record<SkillsHomeOrigin, SkillOriginRootSpec>;

const PROVIDER_SKILL_ORIGIN_PREFERENCES = {
  codex: ["codex", "agents"],
  claudeAgent: ["claude"],
  cursor: ["cursor", "agents", "claude", "codex"],
  antigravity: ["agents"],
  grok: ["grok", "claude", "agents"],
  droid: ["factory", "agents", "claude", "codex"],
  kilo: ["kilo", "agents", "claude"],
  opencode: ["opencode", "claude", "agents"],
  pi: ["pi", "agents"],
} as const satisfies Partial<Record<ProviderKind, readonly SkillsHomeOrigin[]>>;

function orderedOriginsForProvider(
  provider: ProviderKind | null | undefined,
  includeAgentGroupRoot = true,
  includeRemainingOrigins = true,
): SkillsHomeOrigin[] {
  const preferred = provider ? (PROVIDER_SKILL_ORIGIN_PREFERENCES[provider] ?? []) : [];
  const ordered: SkillsHomeOrigin[] = [...preferred];
  if (includeAgentGroupRoot && !ordered.includes("agent-group")) {
    ordered.push("agent-group");
  }
  if (!includeRemainingOrigins) {
    return ordered.filter((origin) => includeAgentGroupRoot || origin !== "agent-group");
  }
  for (const origin of HOME_ORIGIN_ORDER) {
    if (!includeAgentGroupRoot && origin === "agent-group") {
      continue;
    }
    if (!ordered.includes(origin)) {
      ordered.push(origin);
    }
  }
  return ordered;
}

function rootsForOrderedOrigins(
  input: SkillsCatalogRootInput,
  orderedOrigins: ReadonlyArray<SkillsHomeOrigin>,
): SkillRoot[] {
  const homeRoots = orderedOrigins.flatMap((origin) =>
    SKILL_ORIGIN_ROOTS[origin].homeRoots(input).map((path) => ({
      path,
      scope: origin,
      ...(origin === "pi" ? { includeMarkdownFiles: true } : {}),
    })),
  );
  const homeRootPaths = new Set(homeRoots.map((root) => nodePath.resolve(root.path)));

  const projectRoots: SkillRoot[] = [];
  const cwd = input.cwd?.trim();
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const seenRootNames = new Set<string>();
      for (const origin of orderedOrigins) {
        for (const rootName of SKILL_ORIGIN_ROOTS[origin].projectRootNames) {
          if (seenRootNames.has(rootName)) {
            continue;
          }
          seenRootNames.add(rootName);
          const rootPath = nodePath.join(ancestor, rootName, "skills");
          // A cwd under the home dir reaches home skill folders as project
          // ancestors; skip them so each folder retains its true origin scope.
          if (homeRootPaths.has(nodePath.resolve(rootPath))) {
            continue;
          }
          projectRoots.push({
            path: rootPath,
            scope: "project",
            ...(origin === "pi" ? { includeMarkdownFiles: true } : {}),
          });
        }
      }
    }
  }

  return [...projectRoots, ...homeRoots];
}

export function skillsCatalogRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  return rootsForOrderedOrigins(
    input,
    orderedOriginsForProvider(input.provider, input.includeAgentGroupRoot !== false),
  );
}

export function providerNativeSkillRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  return rootsForOrderedOrigins(input, orderedOriginsForProvider(input.provider, false, false));
}
