# Contributing

Thank you for helping improve Agent Group. Focused bug fixes, reliability improvements,
performance work, documentation, and maintenance contributions are welcome.

## Before starting

- Search existing issues and pull requests first.
- Use the issue forms for reproducible bugs and focused feature proposals.
- Discuss non-trivial features or architectural changes in an issue before implementation.
- Report security vulnerabilities through the process in [SECURITY.md](SECURITY.md), not a public
  issue.

## Development

Install the versions declared in `package.json`, then install dependencies:

```sh
bun install --frozen-lockfile
```

Keep changes small and avoid mixing unrelated refactors. Add focused tests for changed behavior.
Use `bun run test`, never `bun test`, when running the workspace test suite.

Before requesting review, run the checks relevant to your change. The complete CI-equivalent set is:

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun run test
bun run build:desktop
```

## Pull requests

A useful pull request:

- explains the problem and the chosen approach;
- links the relevant issue when one exists;
- stays within one clear scope;
- includes tests or explains why none are needed;
- includes before-and-after images for visual changes;
- calls out compatibility, migration, or security impact.

Maintainers may ask for a smaller change or decline work that does not fit the product direction.
That decision is about project scope, not the contributor.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
