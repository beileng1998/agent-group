# Agent Group

Agent Group is a local-first desktop workspace for running multiple coding agents in one project.
Agents share the same files while each Session keeps its own durable conversation and visible
`context.md`.

> Agent Group is under active development. Back up important work and review agent actions before
> relying on it for production workflows.

## Highlights

- Run Codex, Claude Code, Cursor, Antigravity, Grok, Factory Droid, Kilo Code, OpenCode, and Pi.
- Switch provider or model between turns without moving the Session to another workspace.
- Keep Explorer, Terminal, Browser, Diff, chat, and approvals in one desktop application.
- Store projects, Sessions, and application history locally.
- Share explicit Session Context instead of hidden cross-agent memory.

## Run locally

Install Bun 1.3+, Node.js 24+, Git, and at least one supported agent CLI or SDK:

```sh
bun install
bun run dev
```

Desktop development builds use:

```sh
bun run build:desktop
bun run electron
```

## How it works

- A **Group** owns one project directory.
- A **Session** is a durable, nestable conversation inside that Group.
- A **Turn** freezes the selected provider and model for one request.
- Session Context lives at `.agent-group/sessions/<session-id>/context.md`.
- Every Session runs in the Group's canonical working directory; Sessions do not own worktrees.

Provider-native session IDs are replaceable implementation details. When the provider changes,
Agent Group starts the selected adapter in the same project and bootstraps the visible Session
transcript once.

## Security and privacy

Agent Group can run commands and modify files through the selected agent. The default Full Access
mode runs without per-command approval and should be treated like granting the agent direct terminal
access to the project. Use version control, review diffs, and run untrusted projects in an isolated
environment.

Projects, Sessions, and history are stored on the local machine. Prompts, file excerpts, tool
results, and other data required for a turn are sent directly to the provider selected by the user.
Agent Group does not provide a hosted workspace relay.

Remote access must be authenticated and exposed only on a trusted network. See the
[Security Policy](SECURITY.md).

## Project policies

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Upstream

Agent Group is based on [Synara](https://github.com/Emanuele-web04/synara) v0.5.5, commit
`9be46c3c`. This is source attribution only. Upstream review is limited to Agent adapter
capabilities; product identity and packaging remain independent.

## License

Agent Group is available under the [MIT License](LICENSE). Upstream attribution is recorded in
[NOTICE.md](NOTICE.md), and third-party terms are described in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
