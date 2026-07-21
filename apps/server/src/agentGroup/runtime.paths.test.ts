import { execFile } from "node:child_process";
import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { getAgentGroupSession, isAgentGroupWorkspace } from "./runtime";
import { sessionRef, temporaryWorkspace } from "./runtime.testSupport";

const execFileAsync = promisify(execFile);

describe("Agent Group context path safety", () => {
  it("rejects symlinked Agent Group paths", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const invalidWorkspace = await temporaryWorkspace();
    const outside = await temporaryWorkspace();

    await expect(getAgentGroupSession(sessionRef(invalidWorkspace, "../escape"))).rejects.toThrow(
      "Invalid session id",
    );
    await symlink(outside, path.join(workspaceRoot, ".agent-group"));

    await expect(getAgentGroupSession(sessionRef(workspaceRoot, "unsafe"))).rejects.toThrow(
      "symlink",
    );
    await expect(isAgentGroupWorkspace(workspaceRoot)).rejects.toThrow("real directory");
  });

  it("does not follow a symlinked outer Git exclude", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await execFileAsync("git", ["-C", workspaceRoot, "init", "--quiet"], { shell: false });
    const excludePath = path.join(workspaceRoot, ".git/info/exclude");
    const outsideFile = path.join(outside, "exclude");
    await writeFile(outsideFile, "keep\n");
    await unlink(excludePath);
    await symlink(outsideFile, excludePath);

    await expect(getAgentGroupSession(sessionRef(workspaceRoot, "safe"))).rejects.toThrow(
      "Outer Git exclude must be a regular file",
    );
    expect(await readFile(outsideFile, "utf8")).toBe("keep\n");
  });
});
