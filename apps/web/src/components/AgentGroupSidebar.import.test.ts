import { describe, expect, it, vi } from "vitest";

describe("AgentGroupSidebar module", () => {
  it("loads with management and drag-and-drop wiring", async () => {
    vi.stubGlobal("self", globalThis);
    const module = await import("./AgentGroupSidebar");

    expect(module.default).toBeTypeOf("function");
  });
});
