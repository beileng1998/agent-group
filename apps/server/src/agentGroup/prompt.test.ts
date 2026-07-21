import { DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { buildAgentGroupPrompt } from "./prompt";

describe("buildAgentGroupPrompt", () => {
  it("keeps the first-turn envelope minimal and preserves user text and global rules", () => {
    const prompt = buildAgentGroupPrompt({
      userText: "  Implement it.  \n",
      contextPath: ".agent-group/sessions/child/context.md",
      parentContextPath: ".agent-group/sessions/parent/context.md",
      firstTurn: true,
      globalRules: "  Keep prompts short.  ",
      groupRules: "Use this Group's conventions.",
      promptInstructions: DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
    });

    expect(prompt).toBe(
      [
        "<user_request>",
        "  Implement it.  ",
        "",
        "</user_request>",
        "",
        '<session_context path=".agent-group/sessions/child/context.md">',
        "Proactively maintain this file as the current Session context.",
        "</session_context>",
        "",
        '<parent_context path=".agent-group/sessions/parent/context.md">',
        "Reference context from the parent Session.",
        "</parent_context>",
        "",
        '<rules scope="global">',
        "  Keep prompts short.  ",
        "</rules>",
        "",
        '<rules scope="group">',
        "Use this Group's conventions.",
        "</rules>",
      ].join("\n"),
    );
  });

  it("matches the current attachment and browser tool block order", () => {
    const prompt = buildAgentGroupPrompt({
      userText: "Inspect the screenshot.",
      attachments: [
        {
          kind: "image",
          path: "/tmp/attachments/screenshot.png",
        },
      ],
      contextPath: ".agent-group/sessions/session-one/context.md",
      browserSessionId: "session-one",
      firstTurn: false,
      globalRules: "Keep it brief.",
      promptInstructions: DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
    });

    expect(prompt).toContain(
      [
        "<attachments>",
        '<attachment kind="image">/tmp/attachments/screenshot.png</attachment>',
        "</attachments>",
      ].join("\n"),
    );
    expect(prompt).toContain(
      '<browser_tools>\nBrowser tools for this Session:\nplaywright-cli -s=session-one\n</browser_tools>',
    );
    expect(prompt.indexOf("<user_request>")).toBeLessThan(prompt.indexOf("<attachments>"));
    expect(prompt.indexOf("<attachments>")).toBeLessThan(prompt.indexOf("<session_context"));
    expect(prompt.indexOf("<session_context")).toBeLessThan(
      prompt.indexOf("<browser_tools>"),
    );
    expect(prompt.indexOf("<browser_tools>")).toBeLessThan(
      prompt.indexOf('<rules scope="global">'),
    );
  });

  it("omits the parent after the first turn and exposes awareness as a pull command", () => {
    const command = "git -C .agent-group diff abc..def -- 'sessions/*/context.md'";
    const prompt = buildAgentGroupPrompt({
      userText: "Continue.",
      contextPath: ".agent-group/sessions/child/context.md",
      parentContextPath: ".agent-group/sessions/parent/context.md",
      contextAwarenessCommand: command,
      firstTurn: false,
      globalRules: "",
      promptInstructions: DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
    });

    expect(prompt).toContain(
      `<group_context_changes>\nBefore working, run this command and incorporate relevant Context changes from other Sessions.\n${command}\n</group_context_changes>`,
    );
    expect(prompt).not.toContain("<parent_context");
    expect(prompt).not.toContain("diff --git");
    expect(prompt).toContain(
      "Proactively maintain this file as the current Session context.",
    );
  });

  it("adds server-resolved mentioned sessions before awareness and global rules", () => {
    const prompt = buildAgentGroupPrompt({
      userText: 'Compare @"Research notes".',
      contextPath: ".agent-group/sessions/current/context.md",
      contextAwarenessCommand: "git diff --stat",
      mentionedSessions: [
        {
          sessionId: "session-research",
          title: 'Research "notes"',
          contextPath: ".agent-group/sessions/session-research/context.md",
          transcriptPath: "/tmp/session-research.jsonl",
        },
        {
          sessionId: "session-plan",
          title: "Plan",
          contextPath: ".agent-group/sessions/session-plan/context.md",
        },
      ],
      firstTurn: false,
      globalRules: "Keep it short.",
      promptInstructions: DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
    });

    expect(prompt).toContain(
      [
        "<mentioned_sessions>",
        "Reference context from Sessions mentioned by the user.",
        '{"session_id":"session-research","title":"Research \\"notes\\"","context_path":".agent-group/sessions/session-research/context.md","transcript_path":"/tmp/session-research.jsonl"}',
        '{"session_id":"session-plan","title":"Plan","context_path":".agent-group/sessions/session-plan/context.md"}',
        "</mentioned_sessions>",
      ].join("\n"),
    );
    expect(prompt.indexOf("<mentioned_sessions>")).toBeLessThan(
      prompt.indexOf("<group_context_changes>"),
    );
    expect(prompt.indexOf("<group_context_changes>")).toBeLessThan(
      prompt.indexOf('<rules scope="global">'),
    );
  });

  it("uses group-authored descriptions without changing dynamic prompt data", () => {
    const prompt = buildAgentGroupPrompt({
      userText: "Keep this request exact.",
      contextPath: ".agent-group/sessions/current/context.md",
      parentContextPath: ".agent-group/sessions/parent/context.md",
      contextAwarenessCommand: "git diff abc..def",
      browserSessionId: "current",
      firstTurn: true,
      globalRules: "Keep this rule exact.",
      promptInstructions: {
        ...DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
        sessionContextFirstTurn: "Current Session state.",
        parentContext: "Parent Session background.",
        contextChanges: "Unseen context changes.",
        browserTools: "Session browser automation.",
      },
    });

    expect(prompt).toContain("Keep this request exact.");
    expect(prompt).toContain("Current Session state.");
    expect(prompt).toContain("Parent Session background.");
    expect(prompt).toContain("Unseen context changes.\ngit diff abc..def");
    expect(prompt).toContain("Session browser automation.\nplaywright-cli -s=current");
    expect(prompt).toContain("Keep this rule exact.");
  });
});
