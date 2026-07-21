import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findClaudeTranscriptPath, findCodexTranscriptPath } from "./ProviderTranscriptPaths.ts";

describe("provider transcript paths", () => {
  it("finds a Codex rollout by provider thread id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-"));
    const threadId = "019efcc0-2dac-7911-b800-3b30e98ac1e1";
    const transcript = path.join(
      root,
      "sessions",
      "2026",
      "06",
      "25",
      `rollout-2026-06-25T11-08-33-${threadId}.jsonl`,
    );
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(transcript, "{}\n", "utf8");

    await expect(
      findCodexTranscriptPath({ homePath: root, providerThreadId: threadId }),
    ).resolves.toBe(transcript);
  });

  it("finds a Claude project transcript by session id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-"));
    const sessionId = "a171ee2a-dc3b-4c3e-a874-8f8f6498d966";
    const transcript = path.join(root, "projects", "-tmp-project", `${sessionId}.jsonl`);
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(transcript, "{}\n", "utf8");

    await expect(
      findClaudeTranscriptPath({
        homeDir: os.homedir(),
        sessionId,
        env: { CLAUDE_CONFIG_DIR: root },
      }),
    ).resolves.toBe(transcript);
  });

  it("rejects unsafe native ids", async () => {
    await expect(
      findCodexTranscriptPath({ homePath: "/tmp", providerThreadId: "../../secret" }),
    ).resolves.toBeNull();
    await expect(
      findClaudeTranscriptPath({ homeDir: "/tmp", sessionId: "../../secret" }),
    ).resolves.toBeNull();
  });
});
