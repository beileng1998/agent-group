import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { DEFAULT_SERVER_SETTINGS, ProjectId, ThreadId } from "@agent-group/contracts";
import { DEFAULT_CONTEXT_TEMPLATE } from "@agent-group/shared/contextTemplates";
import { afterEach, describe, expect, it } from "vitest";

import {
  finalizeAgentGroupTurn,
  getAgentGroupConfig,
  getAgentGroupOverview,
  getAgentGroupSession,
  isAgentGroupWorkspace,
  markAgentGroupTurnStarted,
  prepareAgentGroupTurn,
  updateAgentGroupConfig,
  updateAgentGroupSession,
  writeAgentGroupContext,
} from "./runtime";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("Agent Group context runtime", () => {
  it("loads Group settings without creating a Session", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const config = await getAgentGroupConfig({
      workspaceRoot,
      groupId: ProjectId.makeUnsafe("empty-group"),
    });

    expect(config.groupId).toBe("empty-group");
    expect(config.contextTemplate).toBe(DEFAULT_CONTEXT_TEMPLATE);
    expect(config.contextTemplateId).toBe("standard");
    expect(config.contextAwarenessDefaultEnabled).toBe(false);
    expect(config.revision).toBe(0);
  });

  it("uses a shared template and Group Awareness default for new Sessions", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const groupId = ProjectId.makeUnsafe("configured-group");
    const globalSettings = {
      ...DEFAULT_SERVER_SETTINGS.agentGroup,
      contextTemplates: [
        {
          id: "team",
          name: "Team",
          description: "Shared team context",
          content: "# Team context\n",
        },
      ],
    };
    await updateAgentGroupConfig({
      workspaceRoot,
      groupId,
      contextTemplateId: "team",
      contextAwarenessDefaultEnabled: true,
      expectedRevision: 0,
      globalSettings,
    });

    const document = await getAgentGroupSession({
      ...sessionRef(workspaceRoot, "default-aware"),
      groupId,
      globalSettings,
    });
    const overview = await getAgentGroupOverview({ workspaceRoot, groupId, globalSettings });

    expect(document.context).toBe("# Team context\n");
    expect(document.session.contextAwarenessEnabled).toBe(true);
    expect(overview.config.contextTemplateId).toBe("team");
    expect(overview.sessions).toEqual([document.session]);
  });

  it("creates raw session context in an independent repository and rejects stale writes", async () => {
    const workspaceRoot = await temporaryWorkspace();
    expect(await isAgentGroupWorkspace(path.join(workspaceRoot, "missing"))).toBe(false);
    await execFileAsync("git", ["-C", workspaceRoot, "init", "--quiet"], { shell: false });
    const input = sessionRef(workspaceRoot, "session-one");
    expect(await isAgentGroupWorkspace(workspaceRoot)).toBe(false);

    const initial = await getAgentGroupSession(input);
    expect(await isAgentGroupWorkspace(workspaceRoot)).toBe(true);
    expect(initial.contextPath).toBe(".agent-group/sessions/session-one/context.md");
    expect(initial.context).toBe(DEFAULT_CONTEXT_TEMPLATE);
    expect(await git(workspaceRoot, "rev-parse", "--show-toplevel")).toBe(
      path.join(workspaceRoot, ".agent-group"),
    );
    expect(await readFile(path.join(workspaceRoot, ".git/info/exclude"), "utf8")).toContain(
      ".agent-group/",
    );

    const saved = await writeAgentGroupContext({
      ...input,
      context: "# Raw\n\nKeep exactly.  \n",
      expectedRevision: initial.contextRevision,
    });
    expect(saved.context).toBe("# Raw\n\nKeep exactly.  \n");
    await expect(
      writeAgentGroupContext({
        ...input,
        context: "stale",
        expectedRevision: initial.contextRevision,
      }),
    ).rejects.toThrow("reload before saving");
    expect(await readFile(path.join(workspaceRoot, saved.contextPath), "utf8")).toBe(
      "# Raw\n\nKeep exactly.  \n",
    );
  });

  it("commits only the selected session context", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const first = sessionRef(workspaceRoot, "session-first");
    const second = sessionRef(workspaceRoot, "session-second");
    await getAgentGroupSession(first);
    await getAgentGroupSession(second);
    const firstPath = path.join(workspaceRoot, ".agent-group/sessions/session-first/context.md");
    const secondPath = path.join(workspaceRoot, ".agent-group/sessions/session-second/context.md");
    await writeFile(firstPath, "first v2\n");
    await writeFile(secondPath, "second v2\n");

    await markAgentGroupTurnStarted(first, "turn-first", null);
    await finalizeAgentGroupTurn({ ...first, turnId: "turn-first", successful: true });

    expect(await git(workspaceRoot, "show", "HEAD:sessions/session-first/context.md")).toBe(
      "first v2",
    );
    expect(await git(workspaceRoot, "show", "HEAD:sessions/session-second/context.md")).not.toBe(
      "second v2",
    );
    expect(await readFile(secondPath, "utf8")).toBe("second v2\n");
  });

  it("adds the outer exclude when the workspace becomes a Git repository later", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "session-late-git");
    await getAgentGroupSession(input);

    await execFileAsync("git", ["-C", workspaceRoot, "init", "--quiet"], { shell: false });
    await prepareAgentGroupTurn({ ...input, userText: "Continue." });

    expect(await readFile(path.join(workspaceRoot, ".git/info/exclude"), "utf8")).toContain(
      ".agent-group/",
    );
  });

  it("uses parent context only on the first successful turn and keeps awareness pull-based", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const parent = sessionRef(workspaceRoot, "parent");
    const child = sessionRef(workspaceRoot, "child", "parent");
    const parentDocument = await getAgentGroupSession(parent);
    const childDocument = await getAgentGroupSession(child);
    await updateAgentGroupSession({
      ...child,
      contextAwarenessEnabled: true,
      expectedRevision: childDocument.config.revision,
    });

    const first = await prepareAgentGroupTurn({ ...child, userText: "Coordinate." });
    if (!first) throw new Error("Expected the first turn to be prepared");
    expect(first.prompt).toContain(
      '<parent_context path=".agent-group/sessions/parent/context.md">',
    );
    expect(first.prompt).toMatch(
      /git -C \.agent-group diff [0-9a-f]{40,64}\.\.[0-9a-f]{40,64} -- 'sessions\/\*\/context\.md'/,
    );
    expect(first.prompt).not.toContain("diff --git");
    await markAgentGroupTurnStarted(child, "turn-child-first", first.awarenessHead);
    const started = await getAgentGroupSession(child);
    expect(started.session.contextSeenCommit).toBeNull();
    await finalizeAgentGroupTurn({
      ...child,
      turnId: "turn-child-first",
      successful: true,
    });
    const finalized = await getAgentGroupSession(child);
    expect(finalized.session.contextSeenCommit).toBe(first.awarenessHead);

    const continuation = await prepareAgentGroupTurn({ ...child, userText: "Continue." });
    if (!continuation) throw new Error("Expected the continuation turn to be prepared");
    expect(continuation.prompt).not.toContain("<parent_context");
    expect(continuation.prompt).toContain(
      "Proactively maintain this file as the current Session context.",
    );
    expect(continuation.prompt).not.toContain("<group_context_changes>");

    await writeAgentGroupContext({
      ...parent,
      context: "Sibling-only detail\n",
      expectedRevision: parentDocument.contextRevision,
    });
    const withChanges = await prepareAgentGroupTurn({ ...child, userText: "Check changes." });
    if (!withChanges) throw new Error("Expected the changed-context turn to be prepared");
    expect(withChanges.prompt).toContain("<group_context_changes>");
    expect(withChanges.prompt).not.toContain("Sibling-only detail");
  });

  it("advances awareness at a terminal event but preserves it across a process interruption", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const parent = sessionRef(workspaceRoot, "awareness-parent");
    const child = sessionRef(workspaceRoot, "awareness-child", "awareness-parent");
    const parentDocument = await getAgentGroupSession(parent);
    const childDocument = await getAgentGroupSession(child);
    await updateAgentGroupSession({
      ...child,
      contextAwarenessEnabled: true,
      expectedRevision: childDocument.config.revision,
    });

    const baseline = await prepareAgentGroupTurn({ ...child, userText: "Establish baseline." });
    expect(baseline).not.toBeNull();
    await markAgentGroupTurnStarted(child, "turn-baseline", baseline?.awarenessHead ?? null);
    await finalizeAgentGroupTurn({ ...child, turnId: "turn-baseline", successful: true });
    const baselineSeenCommit = (await getAgentGroupSession(child)).session.contextSeenCommit;
    expect(baselineSeenCommit).toBe(baseline?.awarenessHead);

    await writeAgentGroupContext({
      ...parent,
      context: "# New parent information\n",
      expectedRevision: parentDocument.contextRevision,
    });
    const failed = await prepareAgentGroupTurn({ ...child, userText: "This will fail." });
    expect(failed?.prompt).toContain("<group_context_changes>");
    await markAgentGroupTurnStarted(child, "turn-failed", failed?.awarenessHead ?? null);
    expect((await getAgentGroupSession(child)).session.contextSeenCommit).toBe(baselineSeenCommit);
    await finalizeAgentGroupTurn({ ...child, turnId: "turn-failed", successful: false });
    expect((await getAgentGroupSession(child)).session.contextSeenCommit).toBe(
      failed?.awarenessHead,
    );

    const parentAfterFailure = await getAgentGroupSession(parent);
    await writeAgentGroupContext({
      ...parent,
      context: "# Newer parent information\n",
      expectedRevision: parentAfterFailure.contextRevision,
    });

    const interrupted = await prepareAgentGroupTurn({ ...child, userText: "This will stop." });
    expect(interrupted?.prompt).toContain("<group_context_changes>");
    await markAgentGroupTurnStarted(child, "turn-interrupted", interrupted?.awarenessHead ?? null);
    const interruptedStatePath = path.join(workspaceRoot, ".agent-group/state.json");
    const interruptedState = JSON.parse(await readFile(interruptedStatePath, "utf8")) as {
      sessions: Record<string, { activeContextRuntimeId: string | null }>;
    };
    const interruptedSession = interruptedState.sessions["awareness-child"];
    if (!interruptedSession) throw new Error("Expected interrupted session state");
    interruptedSession.activeContextRuntimeId = "previous-runtime";
    await writeFile(interruptedStatePath, `${JSON.stringify(interruptedState, null, 2)}\n`);

    // Preparing the next queued Turn lazily reconciles the stale marker left by
    // a process exit, but the unconsumed awareness diff remains available.
    const recovered = await prepareAgentGroupTurn({ ...child, userText: "Recover." });
    expect(recovered?.prompt).toContain("<group_context_changes>");
    expect((await getAgentGroupSession(child)).session.contextSeenCommit).toBe(
      failed?.awarenessHead,
    );
    const state = JSON.parse(
      await readFile(path.join(workspaceRoot, ".agent-group/state.json"), "utf8"),
    ) as {
      sessions: Record<
        string,
        { activeContextTurnId: string | null; activeContextAwarenessHead: string | null }
      >;
    };
    expect(state.sessions["awareness-child"]?.activeContextTurnId).toBeNull();
    expect(state.sessions["awareness-child"]?.activeContextAwarenessHead).toBeNull();
  });

  it("finalizes a persisted turn without a terminal turn id after restart", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "restart-terminal");
    const prepared = await prepareAgentGroupTurn({ ...input, userText: "Finish after restart." });
    await markAgentGroupTurnStarted(input, "turn-before-restart", prepared?.awarenessHead ?? null);

    expect(await finalizeAgentGroupTurn({ ...input, turnId: null, successful: true })).toBeNull();

    const statePath = path.join(workspaceRoot, ".agent-group/state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      sessions: Record<string, { activeContextRuntimeId: string | null }>;
    };
    const session = state.sessions["restart-terminal"];
    if (!session) throw new Error("Expected persisted session state");
    session.activeContextRuntimeId = "previous-runtime";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    await finalizeAgentGroupTurn({ ...input, turnId: null, successful: true });
    const finalized = await getAgentGroupSession(input);
    expect(finalized.session.firstTurnCompleted).toBe(true);
    expect(finalized.session.contextSeenCommit).toBe(prepared?.awarenessHead);
  });

  it("derives mentioned session context paths and creates missing context files", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const current = sessionRef(workspaceRoot, "current");
    const prepared = await prepareAgentGroupTurn({
      ...current,
      userText: 'Use @"Research notes".',
      mentionedSessions: [
        {
          sessionId: ThreadId.makeUnsafe("research"),
          title: "Research notes",
          parentSessionId: ThreadId.makeUnsafe("current"),
          createdAt: "2026-07-17T00:01:00.000Z",
          transcriptPath: "/tmp/research.jsonl",
        },
      ],
    });

    if (!prepared) throw new Error("Expected the mentioned-session turn to be prepared");
    expect(prepared.prompt).toContain('"context_path":".agent-group/sessions/research/context.md"');
    expect(prepared.prompt).toContain('"transcript_path":"/tmp/research.jsonl"');
    expect(
      await readFile(path.join(workspaceRoot, ".agent-group/sessions/research/context.md"), "utf8"),
    ).toContain("# Goal");
    const research = await getAgentGroupSession(sessionRef(workspaceRoot, "research", "current"));
    expect(research.session.parentSessionId).toBe("current");
  });

  it("defaults legacy state to enabled context without changing its revision", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "legacy");
    const initial = await getAgentGroupSession(input);
    const statePath = path.join(workspaceRoot, ".agent-group/state.json");
    const legacy = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    delete legacy.contextEnabled;
    await writeFile(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const loaded = await getAgentGroupSession(input);

    expect(loaded.config.contextEnabled).toBe(true);
    expect(loaded.config.browserToolsEnabled).toBe(false);
    expect(loaded.config.revision).toBe(initial.config.revision);
  });

  it("uses global prompt instructions for every Group turn", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "custom-prompt");
    const promptInstructions = {
      ...DEFAULT_SERVER_SETTINGS.agentGroup.promptInstructions,
      parentContext: "Use parent context only when relevant.",
      mentionedSessions: "Inspect these Sessions selectively.",
    };

    const prepared = await prepareAgentGroupTurn({
      ...input,
      userText: "Continue.",
      mentionedSessions: [
        { sessionId: ThreadId.makeUnsafe("mentioned-custom"), title: "Custom" },
      ],
      globalSettings: {
        ...DEFAULT_SERVER_SETTINGS.agentGroup,
        promptInstructions,
      },
    });

    expect(prepared?.prompt).toContain("Inspect these Sessions selectively.");
  });

  it("reattaches an existing context workspace to a new local group id", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const original = sessionRef(workspaceRoot, "original-session");
    const originalDocument = await getAgentGroupSession(original);
    await writeAgentGroupContext({
      ...original,
      context: "# Existing context\n\nKeep this verbatim.\n",
      expectedRevision: originalDocument.contextRevision,
    });

    const reattached = await getAgentGroupSession({
      ...sessionRef(workspaceRoot, "reattached-session"),
      groupId: ProjectId.makeUnsafe("group-two"),
    });

    expect(reattached.config.groupId).toBe("group-two");
    expect(reattached.context).toBe(DEFAULT_CONTEXT_TEMPLATE);
    expect(
      await readFile(
        path.join(workspaceRoot, ".agent-group/sessions/original-session/context.md"),
        "utf8",
      ),
    ).toBe("# Existing context\n\nKeep this verbatim.\n");
    const state = JSON.parse(
      await readFile(path.join(workspaceRoot, ".agent-group/state.json"), "utf8"),
    ) as { groupId: string };
    expect(state.groupId).toBe("group-one");

    const updated = await updateAgentGroupConfig({
      workspaceRoot,
      groupId: ProjectId.makeUnsafe("group-two"),
      globalRules: "Shared portable rules.",
      expectedRevision: reattached.config.revision,
    });
    expect(updated.groupId).toBe("group-two");

    const originalReloaded = await getAgentGroupSession(original);
    expect(originalReloaded.config.groupId).toBe("group-one");
    expect(originalReloaded.config.globalRules).toBe("Shared portable rules.");
  });

  it("suspends the context lifecycle while global Agent Group context is disabled", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const parent = sessionRef(workspaceRoot, "parent-disabled");
    const child = sessionRef(workspaceRoot, "child-disabled", "parent-disabled");
    await getAgentGroupSession(parent);
    await getAgentGroupSession(child);

    const prepared = await prepareAgentGroupTurn({
      ...child,
      userText: "  Send this unchanged.  ",
      globalSettings: {
        ...DEFAULT_SERVER_SETTINGS.agentGroup,
        contextEnabled: false,
        globalRules: "This must stay out of disabled turns.",
      },
      mentionedSessions: [
        {
          sessionId: ThreadId.makeUnsafe("mentioned-disabled"),
          title: "Mentioned disabled",
        },
      ],
    });
    expect(prepared).toBeNull();
    expect(
      await fileExists(
        path.join(workspaceRoot, ".agent-group/sessions/mentioned-disabled/context.md"),
      ),
    ).toBe(false);

    const finalized = await finalizeAgentGroupTurn({
      ...child,
      turnId: "turn-started-while-disabled",
      successful: true,
    });
    const afterDisabledTurn = await getAgentGroupSession(child);
    const enabled = await updateAgentGroupConfig({
      workspaceRoot,
      groupId: child.groupId,
      browserToolsEnabled: true,
      globalRules: "Shared group rules.",
      expectedRevision: afterDisabledTurn.config.revision,
    });
    const resumed = await prepareAgentGroupTurn({
      ...child,
      userText: "Resume context.",
      globalSettings: {
        ...DEFAULT_SERVER_SETTINGS.agentGroup,
        globalRules: "Shared global rules.",
      },
    });

    expect(finalized).toBeNull();
    expect(afterDisabledTurn.session.firstTurnCompleted).toBe(false);
    expect(resumed?.prompt).toContain(
      '<parent_context path=".agent-group/sessions/parent-disabled/context.md">',
    );
    expect(resumed?.prompt).toContain(
      '<browser_tools>\nBrowser tools for this Session:\nplaywright-cli -s=child-disabled\n</browser_tools>',
    );
    expect(resumed?.prompt).toContain("Shared global rules.");
    expect(resumed?.prompt).toContain(
      '<rules scope="group">\nShared group rules.\n</rules>',
    );
    expect(enabled.browserToolsEnabled).toBe(true);
    expect(resumed?.prompt).not.toContain("This must stay out of disabled turns.");
  });

  it("finalizes an enveloped turn independently of later global setting changes", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const input = sessionRef(workspaceRoot, "toggle-after-prepare");
    const prepared = await prepareAgentGroupTurn({ ...input, userText: "Do the work." });

    await markAgentGroupTurnStarted(input, "turn-before-disable", prepared?.awarenessHead ?? null);
    await finalizeAgentGroupTurn({ ...input, turnId: "turn-before-disable", successful: true });
    const after = await getAgentGroupSession(input);

    expect(after.session.firstTurnCompleted).toBe(true);
  });

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

function sessionRef(workspaceRoot: string, sessionId: string, parentSessionId?: string) {
  return {
    workspaceRoot,
    groupId: ProjectId.makeUnsafe("group-one"),
    sessionId: ThreadId.makeUnsafe(sessionId),
    ...(parentSessionId ? { parentSessionId: ThreadId.makeUnsafe(parentSessionId) } : {}),
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

async function temporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-group-"));
  const canonical = await realpath(directory);
  cleanup.push(canonical);
  return canonical;
}

async function git(workspaceRoot: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", path.join(workspaceRoot, ".agent-group"), ...args],
    { encoding: "utf8", shell: false },
  );
  return stdout.trim();
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
