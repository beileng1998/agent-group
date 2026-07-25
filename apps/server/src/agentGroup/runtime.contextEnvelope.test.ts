import { DEFAULT_SERVER_SETTINGS } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { prepareAgentGroupTurn, updateAgentGroupConfig } from "./runtime";
import { sessionRef, temporaryWorkspace } from "./runtime.testSupport";

describe("Agent Group context envelope", () => {
  it("exposes the exact envelope used by the structured prompt", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "same-envelope");
    const globalSettings = {
      ...DEFAULT_SERVER_SETTINGS.agentGroup,
      globalRules: "  Keep this Global rule raw.  \n",
    };
    await updateAgentGroupConfig({
      workspaceRoot,
      groupId: input.groupId,
      globalRules: "  Keep this Group rule raw.  \n",
      expectedRevision: 0,
      globalSettings,
    });

    const prepared = await prepareAgentGroupTurn({
      ...input,
      userText: "  Keep this request raw.  \n",
      attachments: [{ kind: "file", path: "/tmp/raw input.md" }],
      globalSettings,
    });

    if (!prepared) throw new Error("Expected the turn to be prepared");
    expect(prepared.contextEnvelope).not.toContain("<user_request>");
    expect(prepared.contextEnvelope).not.toContain("<attachments>");
    expect(prepared.contextEnvelope).toContain(
      '<rules scope="global">\n  Keep this Global rule raw.  \n\n</rules>',
    );
    expect(prepared.contextEnvelope).toContain(
      '<rules scope="group">\n  Keep this Group rule raw.  \n\n</rules>',
    );
    expect(prepared.prompt).toBe(
      [
        "<user_request>\n  Keep this request raw.  \n\n</user_request>",
        '<attachments>\n<attachment kind="file">/tmp/raw input.md</attachment>\n</attachments>',
        prepared.contextEnvelope,
      ].join("\n\n"),
    );
  });
});
