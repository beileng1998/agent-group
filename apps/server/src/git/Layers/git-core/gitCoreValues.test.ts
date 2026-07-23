import { describe, expect, it } from "vitest";

import { parseNumstatEntries, parsePorcelainPath } from "./gitCoreValues.ts";

describe("Git quoted path parsing", () => {
  it("decodes UTF-8 paths from numstat output", () => {
    expect(parseNumstatEntries('2\t1\t"docs/\\344\\270\\255\\346\\226\\207.md"\n')).toEqual([
      { path: "docs/中文.md", insertions: 2, deletions: 1 },
    ]);
  });

  it("decodes UTF-8 paths from porcelain output", () => {
    expect(parsePorcelainPath('? "docs/\\344\\270\\255\\346\\226\\207.md"')).toBe("docs/中文.md");
  });
});
