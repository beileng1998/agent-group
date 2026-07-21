import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  getPiSupportedThinkingOptions,
  isPiThinkingLevel,
  normalizePiThinkingLevel,
} from "./piAdapterCore.ts";

describe("Pi max thinking", () => {
  it("accepts max through the adapter validator", () => {
    expect(isPiThinkingLevel("max")).toBe(true);
    expect(normalizePiThinkingLevel("max")).toBe("max");
  });

  it("advertises max only when the concrete model opts into it", () => {
    const model = {
      reasoning: true,
      thinkingLevelMap: { max: "max" },
    } satisfies Pick<Model<Api>, "reasoning" | "thinkingLevelMap">;

    expect(getPiSupportedThinkingOptions(model).map((option) => option.value)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
  });
});
