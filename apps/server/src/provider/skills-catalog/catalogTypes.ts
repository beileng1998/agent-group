import type { ProviderKind } from "@agent-group/contracts";

export interface SkillRoot {
  readonly path: string;
  readonly scope: string;
  readonly includeMarkdownFiles?: boolean;
}

export interface SkillsCatalogDiscoveryInput {
  /** Optional workspace cwd; when present, project-level skill folders are included. */
  readonly cwd?: string | null;
  readonly homeDir: string;
  /** Agent Group base dir (usually `~/.agent-group`); skills live in `{base}/skills`. */
  readonly agentGroupBaseDir: string;
  /** Provider whose native copies should win when the same skill exists in several roots. */
  readonly provider?: ProviderKind | null;
  /** Settings needs every origin; composer/provider pickers keep one winner by name. */
  readonly includeDuplicateOrigins?: boolean;
  /** Bypass the short-lived discovery cache. */
  readonly forceReload?: boolean;
}

export interface SkillsCatalogRootInput extends SkillsCatalogDiscoveryInput {
  /** Native provider scans can opt out; the catalog itself always includes Agent Group. */
  readonly includeAgentGroupRoot?: boolean;
}

export type SkillsCatalogOrigin =
  | "agent-group"
  | "codex"
  | "claude"
  | "cursor"
  | "grok"
  | "factory"
  | "kilo"
  | "opencode"
  | "pi"
  | "agents"
  | "project";
