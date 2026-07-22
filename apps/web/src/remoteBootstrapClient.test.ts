import { describe, expect, it } from "vitest";

import { resolveRemoteBootstrapThreadId } from "./remoteBootstrapClient";

describe("remote bootstrap route selection", () => {
  const threadId = "6ddcfa2d-ed70-435b-9386-26124355cb1e";

  it("selects the current UUID thread route for pre-render hydration", () => {
    expect(resolveRemoteBootstrapThreadId(`/${threadId}`)).toBe(threadId);
  });

  it.each(["/", "/pair", "/settings", `/${threadId}/nested`, "/not-a-thread"])(
    "does not mistake %s for a current thread route",
    (pathname) => {
      expect(resolveRemoteBootstrapThreadId(pathname)).toBeNull();
    },
  );
});
