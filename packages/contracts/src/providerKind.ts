import { Schema } from "effect";

export const ProviderKind = Schema.Literals([
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
]);
export type ProviderKind = typeof ProviderKind.Type;
