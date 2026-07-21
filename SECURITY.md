# Security Policy

## Supported versions

Security fixes target the current `main` branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability
reporting flow from the repository's **Security** tab.

Include:

- the affected version and platform;
- reproduction steps or a proof of concept;
- the expected impact;
- any known mitigations.

You should receive an acknowledgement within seven days. We will coordinate disclosure after the
issue is understood and a fix or mitigation is available.

## Security model

Agent Group executes third-party agent runtimes on the user's machine. In Full Access mode, an agent
can run commands and modify files without per-command approval. Users should review diffs, keep
projects under version control, and isolate untrusted repositories.

Local storage protects data from an Agent Group cloud service, but it does not isolate data from the
selected provider or from local processes with access to the same account. Provider-specific data is
subject to that provider's terms and security controls.

Remote access must use authentication and a trusted private network. Never expose an unauthenticated
Agent Group server to the public internet.
