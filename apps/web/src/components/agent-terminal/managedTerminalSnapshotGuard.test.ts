import { describe, expect, it } from "vitest";

import { ManagedTerminalSnapshotGuard } from "./managedTerminalSnapshotGuard";

describe("ManagedTerminalSnapshotGuard", () => {
  it("locks an oversized snapshot until the runtime epoch changes", () => {
    const guard = new ManagedTerminalSnapshotGuard(4);
    const first = { revision: 1, generation: "generation-1" };

    expect(guard.evaluate(first, "🙂x")).toBe("oversized");
    expect(guard.evaluate(first, "ok")).toBe("blocked");
    guard.observeFence(first);
    expect(guard.evaluate(first, "ok")).toBe("blocked");

    const second = { revision: 2, generation: "generation-2" };
    guard.observeFence(second);
    expect(guard.evaluate(second, "🙂")).toBe("accept");
  });
});
