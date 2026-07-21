# Verify Agent Group locally

Use an isolated state directory and explicit ports:

```sh
env -u AGENT_GROUP_AUTH_TOKEN \
  AGENT_GROUP_PORT_OFFSET=3158 \
  AGENT_GROUP_NO_BROWSER=1 \
  bun run dev -- --home-dir ./.agent-group/verify --port 58090 --dry-run
```

Check the resolved server and web ports, then rerun without `--dry-run`. Do not reuse a running
desktop instance's ports or state. Prefer focused tests before interactive verification.
