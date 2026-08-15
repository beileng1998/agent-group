import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { runBoundedProviderControl } from "./boundedProviderControl.ts";

describe("runBoundedProviderControl", () => {
  it("returns successful values", async () => {
    await expect(
      Effect.runPromise(
        runBoundedProviderControl({
          label: "Provider interrupt",
          timeoutMs: 50,
          effect: Effect.succeed("done"),
        }),
      ),
    ).resolves.toEqual({ _tag: "completed", value: "done" });
  });

  it("turns a stalled call into a bounded timeout", async () => {
    await expect(
      Effect.runPromise(
        runBoundedProviderControl({
          label: "Provider interrupt",
          timeoutMs: 5,
          effect: Effect.never,
        }),
      ),
    ).resolves.toEqual({
      _tag: "timeout",
      detail: "Provider interrupt did not respond within 5ms.",
    });
  });

  it("returns ordinary provider failures as control results", async () => {
    const result = await Effect.runPromise(
      runBoundedProviderControl({
        label: "Provider stop",
        timeoutMs: 50,
        effect: Effect.fail(new Error("stop failed")),
      }),
    );

    expect(result._tag).toBe("failed");
    expect(result.detail).toContain("stop failed");
  });
});
