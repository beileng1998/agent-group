// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use native pipe path helpers.
// Layer: Desktop test
// Depends on: Vitest and browserUsePipeServer path resolution exports

import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  AGENT_GROUP_BROWSER_USE_PIPE_ENV,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
} from "./browserUsePipeServer";

describe("browser-use pipe path resolution", () => {
  it("creates a discoverable unix socket path under the Codex browser-use directory", () => {
    const pipePath = resolveDefaultBrowserUsePipePath("darwin");

    expect(dirname(pipePath)).toBe(`${tmpdir()}/codex-browser-use`);
    expect(basename(pipePath)).toMatch(/^agent-group-iab-\d+\.sock$/);
  });

  it("prefers an explicit Agent Group pipe path from the environment", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [AGENT_GROUP_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/agent-group.sock",
        },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/agent-group.sock");
  });

  it("falls back to the generated path when the environment is empty", () => {
    expect(resolveConfiguredBrowserUsePipePath({}, "darwin")).toMatch(
      /codex-browser-use\/agent-group-iab-\d+\.sock$/,
    );
  });
});
