import {
  type ProviderSession,
  ThreadId,
} from "@agent-group/contracts";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveAvailableTerminalLaunchContinuity,
  resolveTerminalLaunchContinuity,
} from "./terminalAgentLaunchContinuity";

const threadId = ThreadId.makeUnsafe("terminal-continuity-thread");
const session = (
  provider: ProviderSession["provider"],
  resumeCursor: unknown,
): ProviderSession => ({
  provider,
  status: "closed",
  runtimeMode: "approval-required",
  threadId,
  resumeCursor,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
});

describe("terminal launch continuity", () => {
  it("resumes Codex from durable continuity when no runtime is active", () => {
    expect(
      resolveTerminalLaunchContinuity({
        sessions: [],
        threadId,
        provider: "codex",
        operation: "start",
        providerSessionId: null,
        resume: false,
        persistedResumeCursor: { threadId: "durable-codex-thread" },
      }),
    ).toEqual({
      providerSessionId: "durable-codex-thread",
      providerResumeCursor: { threadId: "durable-codex-thread" },
      resume: true,
    });
  });

  it.each([
    [
      "codex",
      { threadId: "codex-thread" },
      "codex-thread",
      { threadId: "codex-thread" },
    ],
    [
      "claudeAgent",
      { resume: "claude-session" },
      "claude-session",
      { resume: "claude-session" },
    ],
  ] as const)("prefers a persisted %s cursor when entering Terminal", (
    provider,
    resumeCursor,
    expectedSessionId,
    expectedCursor,
  ) => {
    expect(
      resolveTerminalLaunchContinuity({
        sessions: [session(provider, resumeCursor)],
        threadId,
        provider,
        operation: "start",
        providerSessionId: "fresh-session",
        resume: false,
      }),
    ).toEqual({
      providerSessionId: expectedSessionId,
      providerResumeCursor: expectedCursor,
      resume: true,
    });
  });

  it("uses Pi's file cursor for entry and stable session id for restart", () => {
    const sessions = [session("pi", "/managed/pi/session.jsonl")];
    expect(
      resolveTerminalLaunchContinuity({
        sessions,
        threadId,
        provider: "pi",
        operation: "start",
        providerSessionId: "fresh-pi-id",
        resume: false,
        homeDir: os.homedir(),
      }),
    ).toEqual({
      providerSessionId: null,
      providerResumeCursor: "/managed/pi/session.jsonl",
      resume: true,
    });
    expect(
      resolveTerminalLaunchContinuity({
        sessions,
        threadId,
        provider: "pi",
        operation: "restart",
        providerSessionId: "stable-pi-id",
        resume: true,
      }),
    ).toEqual({
      providerSessionId: "stable-pi-id",
      providerResumeCursor: null,
      resume: true,
    });
  });

  it("treats Pi's unflushed candidate path as a fresh session", async () => {
    await expect(
      resolveAvailableTerminalLaunchContinuity({
        sessions: [session("pi", "/missing/pi/session.jsonl")],
        threadId,
        provider: "pi",
        operation: "start",
        providerSessionId: "fresh-pi-id",
        resume: false,
      }),
    ).resolves.toEqual({
      providerSessionId: "fresh-pi-id",
      providerResumeCursor: null,
      resume: false,
    });
  });

  it("resumes only Claude transcripts that still exist", async () => {
    const claudeConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "terminal-claude-continuity-"),
    );
    const claudeSessionId = "a171ee2a-dc3b-4c3e-a874-8f8f6498d966";
    const claudeTranscript = path.join(
      claudeConfigDir,
      "projects",
      "-tmp-project",
      `${claudeSessionId}.jsonl`,
    );
    await mkdir(path.dirname(claudeTranscript), { recursive: true });
    await writeFile(claudeTranscript, "{}\n", "utf8");

    await expect(
      resolveAvailableTerminalLaunchContinuity({
        sessions: [session("claudeAgent", { resume: claudeSessionId })],
        threadId,
        provider: "claudeAgent",
        operation: "start",
        providerSessionId: "fresh-claude-session",
        resume: false,
        homeDir: os.homedir(),
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      }),
    ).resolves.toMatchObject({
      providerSessionId: claudeSessionId,
      resume: true,
    });
    await expect(
      resolveAvailableTerminalLaunchContinuity({
        sessions: [
          session("claudeAgent", {
            resume: "b171ee2a-dc3b-4c3e-a874-8f8f6498d966",
          }),
        ],
        threadId,
        provider: "claudeAgent",
        operation: "start",
        providerSessionId: "fresh-claude-session",
        resume: false,
        homeDir: os.homedir(),
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      }),
    ).resolves.toEqual({
      providerSessionId: "fresh-claude-session",
      providerResumeCursor: null,
      resume: false,
    });
  });

  it("falls back when a durable Codex cursor has no native transcript", async () => {
    const codexHome = await mkdtemp(
      path.join(os.tmpdir(), "terminal-codex-continuity-"),
    );
    await expect(
      resolveAvailableTerminalLaunchContinuity({
        sessions: [],
        threadId,
        provider: "codex",
        operation: "start",
        providerSessionId: null,
        resume: false,
        persistedResumeCursor: {
          threadId: "019efcc0-2dac-7911-b800-3b30e98ac1e1",
        },
        homeDir: os.homedir(),
        codexHomePath: codexHome,
        env: {},
      }),
    ).resolves.toEqual({
      providerSessionId: null,
      providerResumeCursor: null,
      resume: false,
    });
  });
});
