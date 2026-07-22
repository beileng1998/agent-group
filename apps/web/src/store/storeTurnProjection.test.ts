import { describe, expect, it } from "vitest";

import { normalizeTurnDiffFiles } from "./storeTurnProjection";

describe("normalizeTurnDiffFiles", () => {
  it("decodes historical Git quoted UTF-8 paths before displaying them", () => {
    expect(
      normalizeTurnDiffFiles(
        [
          {
            path: "04 Resources/\\344\\270\\255\\346\\226\\207.md",
            kind: "modified",
            additions: 2,
            deletions: 1,
          },
        ],
        undefined,
      ),
    ).toEqual([
      {
        path: "04 Resources/中文.md",
        kind: "modified",
        additions: 2,
        deletions: 1,
      },
    ]);
  });
});
