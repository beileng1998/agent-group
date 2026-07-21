# AGENTS.md

## Rules

- Prefer simple, maintainable changes. Optimize for correctness, reliability, performance, and predictable failure recovery; extract shared logic instead of duplicating it.
- Keep app prompts minimal and English. Preserve the user request and Group global rules verbatim.
- Preserve unrelated and concurrent work in the checkout.

## Product Invariants

- Group = Project, Session = Thread, and Agent = the Turn's `ModelSelection`. All Sessions share the Group's canonical `workspaceRoot`; never create per-Session worktrees.
- Treat `context.md` as raw user/Agent Markdown. Never parse, normalize, validate, summarize, or rewrite its structure.
- Cross-Agent continuity uses Session Context plus one visible-transcript bootstrap when the provider changes. Never use hidden summaries or provider resume cursors.
- Switch providers only between Turns: stop the old binding, clear provider state, then start the new adapter in the same workspace.
- Runtime subagents are Turn activity, not child Sessions. Do not add One Brain memory, artifact, or environment-revision concepts.

## Boundaries

- Keep `packages/contracts` schema-only. Put shared runtime utilities in explicit `@agent-group/shared/*` subpaths; do not add a barrel export.
- Reuse `apps/web/src/lib/disclosureMotion.ts` and the shared disclosure components for every open/close animation.
- Auto-scroll only for live assistant text. Tool rows, buffering, reconnecting, and approvals must not trigger it.
- Do not couple virtualizer measurement to bottom-stick or height-follow cycles. Add focused tests when changing transcript scrolling or measurement.

## Commands

- Run `bun fmt`, `bun lint`, and `bun typecheck` only when explicitly requested; if requested, run them together once near completion.
- Never run `bun test`; use `bun run test` and prefer focused tests.
- Do not start the default dev instance beside another one. Use an isolated home directory and non-default ports, dry-run first, and unset `AGENT_GROUP_AUTH_TOKEN` for browser instances unless the client uses it.
