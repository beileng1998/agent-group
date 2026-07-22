import { describe, expect, it } from "vitest";

import { extractChangedFiles } from "./sessionWorkLogPayload";

describe("extractChangedFiles", () => {
  it("decodes Git quoted UTF-8 paths in tool activity", () => {
    expect(
      extractChangedFiles({
        data: { files: [{ path: "docs/\\344\\270\\255\\346\\226\\207.pdf" }] },
      }),
    ).toEqual(["docs/中文.pdf"]);
  });
});
