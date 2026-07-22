import { describe, expect, it } from "vitest";

import { buildCodexVisualizationDocument } from "./CodexVisualizationDocument";

describe("Codex visualization sandbox document", () => {
  it("wraps the fragment with a restrictive host bridge", () => {
    const document = buildCodexVisualizationDocument({
      fragment: '<button class="btn">Choose</button>',
      theme: "dark",
      bridgeToken: "bridge-token",
    });
    expect(document).toContain('data-theme="dark"');
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("agent-group.visualization.follow-up");
    expect(document).toContain('<button class="btn">Choose</button>');
    expect(document).not.toContain("allow-same-origin");
  });
});
