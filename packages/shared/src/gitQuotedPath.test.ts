import { describe, expect, it } from "vitest";

import { decodeGitQuotedPath } from "./gitQuotedPath";

describe("decodeGitQuotedPath", () => {
  it("decodes Git octal UTF-8 bytes after a patch parser removes outer quotes", () => {
    expect(decodeGitQuotedPath("04 Resources/\\344\\270\\255\\346\\226\\207.md")).toBe(
      "04 Resources/中文.md",
    );
  });

  it("decodes a complete C-style quoted Git path", () => {
    expect(decodeGitQuotedPath('"docs/\\344\\270\\255\\346\\226\\207\\tcopy.md"')).toBe(
      "docs/中文\tcopy.md",
    );
  });

  it("leaves normal Unicode and ambiguous ASCII backslash paths unchanged", () => {
    expect(decodeGitQuotedPath("docs/中文.md")).toBe("docs/中文.md");
    expect(decodeGitQuotedPath("docs\\123.md")).toBe("docs\\123.md");
  });

  it("leaves invalid UTF-8 byte sequences unchanged", () => {
    expect(decodeGitQuotedPath("docs/\\350.md")).toBe("docs/\\350.md");
  });
});
