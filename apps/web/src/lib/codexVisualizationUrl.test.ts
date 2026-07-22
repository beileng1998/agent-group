import { afterEach, describe, expect, it } from "vitest";

import { buildCodexVisualizationUrl } from "./codexVisualizationUrl";

describe("buildCodexVisualizationUrl", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("builds the same-origin visualization route", () => {
    expect(
      buildCodexVisualizationUrl({
        threadId: "thread-1",
        messageId: "assistant:message-1",
        fileName: "status-map.html",
      }),
    ).toBe(
      "/api/codex-visualization?threadId=thread-1&messageId=assistant%3Amessage-1&file=status-map.html",
    );
  });
});
