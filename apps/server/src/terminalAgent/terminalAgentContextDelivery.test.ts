import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TurnId, type TerminalAgentProvider } from "@agent-group/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { deliverTerminalAgentContext } from "./terminalAgentContextDelivery";

const tempDirs: string[] = [];

async function makeTempDir(prefix = "agent-group-context-"): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function deliver(input: {
  readonly runtimeDir: string;
  readonly provider?: TerminalAgentProvider;
  readonly turnId?: string;
  readonly envelope: string;
}) {
  return deliverTerminalAgentContext({
    runtimeDir: input.runtimeDir,
    provider: input.provider ?? "codex",
    turnId: TurnId.makeUnsafe(input.turnId ?? "turn-1"),
    envelope: input.envelope,
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("deliverTerminalAgentContext inline delivery", () => {
  it.each([
    ["codex", 8_000],
    ["claudeAgent", 9_000],
    ["pi", 128_000],
  ] as const)("keeps %s context inline through its exact limit", async (provider, limit) => {
    const runtimeDir = await makeTempDir();
    const envelope = "x".repeat(limit);

    const delivered = await deliver({ runtimeDir, provider, envelope });

    expect(delivered).toEqual({
      text: envelope,
      checksum: createHash("sha256").update(envelope).digest("hex"),
      delivery: "inline",
      filePath: null,
    });
    await expect(fs.lstat(path.join(runtimeDir, "context"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    ["codex", 8_000],
    ["claudeAgent", 9_000],
    ["pi", 128_000],
  ] as const)("moves %s context to a file above its limit", async (provider, limit) => {
    const runtimeDir = await makeTempDir();
    const delivered = await deliver({
      runtimeDir,
      provider,
      envelope: "x".repeat(limit + 1),
    });

    expect(delivered.delivery).toBe("file-reference");
    expect(delivered.filePath).not.toBeNull();
  });
});

describe("deliverTerminalAgentContext private file delivery", () => {
  it("writes exact content to portable, private paths", async () => {
    const runtimeDir = await makeTempDir();
    const envelope = "context".repeat(2_000);

    const delivered = await deliver({
      runtimeDir,
      turnId: "terminal-turn:unsafe/path",
      envelope,
    });

    expect(delivered.delivery).toBe("file-reference");
    expect(delivered.checksum).toBe(createHash("sha256").update(envelope).digest("hex"));
    expect(path.basename(delivered.filePath ?? "")).toMatch(/^[a-f0-9]{64}-[a-f0-9]{64}\.md$/u);
    expect(delivered.text).toBe(
      `Read the complete Agent Group context at ${delivered.filePath} before acting.`,
    );
    expect(await fs.readFile(delivered.filePath!, "utf8")).toBe(envelope);

    const directoryStat = await fs.lstat(path.join(runtimeDir, "context"));
    const fileStat = await fs.lstat(delivered.filePath!);
    expect(directoryStat.isDirectory()).toBe(true);
    expect(directoryStat.isSymbolicLink()).toBe(false);
    expect(directoryStat.mode & 0o777).toBe(0o700);
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isSymbolicLink()).toBe(false);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("reuses only an identical regular file and restores private permissions", async () => {
    const runtimeDir = await makeTempDir();
    const envelope = "large-context".repeat(1_000);
    const first = await deliver({ runtimeDir, envelope });
    await fs.chmod(first.filePath!, 0o644);

    const second = await deliver({ runtimeDir, envelope });

    expect(second).toEqual(first);
    expect((await fs.lstat(second.filePath!)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(second.filePath!, "utf8")).toBe(envelope);
  });

  it("fails closed if an existing context file has different content", async () => {
    const runtimeDir = await makeTempDir();
    const envelope = "large-context".repeat(1_000);
    const first = await deliver({ runtimeDir, envelope });
    await fs.writeFile(first.filePath!, "unexpected content");

    await expect(deliver({ runtimeDir, envelope })).rejects.toThrow("contains unexpected content");
    expect(await fs.readFile(first.filePath!, "utf8")).toBe("unexpected content");
  });
});

describe("deliverTerminalAgentContext symlink boundaries", () => {
  it.runIf(process.platform !== "win32")(
    "refuses an existing context file symlink without touching its target",
    async () => {
      const runtimeDir = await makeTempDir();
      const envelope = "large-context".repeat(1_000);
      const first = await deliver({ runtimeDir, envelope });
      const targetDir = await makeTempDir("agent-group-context-target-");
      const targetPath = path.join(targetDir, "target.md");
      await fs.writeFile(targetPath, "protected target");
      await fs.rm(first.filePath!);
      await fs.symlink(targetPath, first.filePath!);

      await expect(deliver({ runtimeDir, envelope })).rejects.toThrow(
        "contains unexpected content",
      );
      expect(await fs.readFile(targetPath, "utf8")).toBe("protected target");
      expect((await fs.lstat(first.filePath!)).isSymbolicLink()).toBe(true);
    },
  );

  it.runIf(process.platform !== "win32")(
    "refuses a context directory symlink without writing outside the runtime",
    async () => {
      const runtimeDir = await makeTempDir();
      const targetDir = await makeTempDir("agent-group-context-dir-target-");
      await fs.symlink(targetDir, path.join(runtimeDir, "context"));

      await expect(
        deliver({
          runtimeDir,
          envelope: "large-context".repeat(1_000),
        }),
      ).rejects.toThrow();
      expect(await fs.readdir(targetDir)).toEqual([]);
      expect((await fs.lstat(path.join(runtimeDir, "context"))).isSymbolicLink()).toBe(true);
    },
  );
});
