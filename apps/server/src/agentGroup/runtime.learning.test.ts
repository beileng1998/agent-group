import { ProjectId, ThreadId } from "@agent-group/contracts";
import {
  LEARNING_CONTEXT_TEMPLATE_CONTENT,
  LEARNING_CONTEXT_TEMPLATE_ID,
} from "@agent-group/shared/learningContext";
import { describe, expect, it } from "vitest";

import {
  getAgentGroupSession,
  updateAgentGroupConfig,
  updateAgentGroupSession,
} from "./runtime";
import { sessionRef, temporaryWorkspace } from "./runtime.testSupport";

describe("Agent Group learning sessions", () => {
  it("selects the fixed Learning template without adding it to editable settings", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const groupId = ProjectId.makeUnsafe("learning-group");
    await updateAgentGroupConfig({
      workspaceRoot,
      groupId,
      contextTemplateId: LEARNING_CONTEXT_TEMPLATE_ID,
      expectedRevision: 0,
    });

    const document = await getAgentGroupSession({
      ...sessionRef(workspaceRoot, "learning-session"),
      groupId,
    });

    expect(document.config.contextTemplateId).toBe(LEARNING_CONTEXT_TEMPLATE_ID);
    expect(document.context).toBe(LEARNING_CONTEXT_TEMPLATE_CONTENT);
  });

  it("keeps immutable learning origin and content-specific acknowledgement history", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "learning-child", "learning-parent");
    const created = await getAgentGroupSession(input);
    const origin = {
      sourceSessionId: ThreadId.makeUnsafe("learning-parent"),
      sourceContextRevision: "parent-revision",
      cardKey: "xor\n1",
      cardTitle: "XOR",
      cardMarkdown: "## XOR\n\nInputs differ.",
      selectedText: null,
    };
    const acknowledged = await updateAgentGroupSession({
      ...input,
      learningOrigin: origin,
      knowledgeAcknowledgement: {
        cardKey: origin.cardKey,
        cardMarkdown: origin.cardMarkdown,
        acknowledgedAt: "2026-07-26T00:00:00.000Z",
      },
      expectedRevision: created.config.revision,
    });

    expect(acknowledged.session.learningOrigin).toEqual(origin);
    expect(acknowledged.session.knowledgeAcknowledgements).toEqual([
      {
        cardKey: origin.cardKey,
        cardMarkdown: origin.cardMarkdown,
        acknowledgedAt: "2026-07-26T00:00:00.000Z",
      },
    ]);

    await expect(
      updateAgentGroupSession({
        ...input,
        learningOrigin: { ...origin, cardTitle: "Changed" },
        expectedRevision: acknowledged.config.revision,
      }),
    ).rejects.toThrow("Learning origin cannot be changed");
  });
});
