import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acknowledgeAgentGroupStorageSnapshot,
  readAgentGroupStorageSnapshot,
  saveAgentGroupStorageSnapshot,
  AGENT_GROUP_STORAGE_SNAPSHOT_MAX_BYTES,
  validateAgentGroupStorageSnapshot,
} from "./desktopStorageMigration";

const snapshot = (exportedAt = "2026-07-09T00:00:00.000Z") => ({
  version: 1 as const,
  exportedAt,
  entries: {
    "agent-group:theme": "dark",
    "agent-group.openUsage.enabled": "true",
  },
});

describe("desktopStorageMigration", () => {
  it("round-trips atomically and acknowledges the snapshot", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "agent-group-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await expect(saveAgentGroupStorageSnapshot(target, snapshot())).resolves.toBe(true);
      expect(readAgentGroupStorageSnapshot(target)).toEqual(snapshot());
      expect(FS.readdirSync(directory)).toEqual(["snapshot.json"]);

      await acknowledgeAgentGroupStorageSnapshot(target);
      expect(readAgentGroupStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed, disallowed, and oversized snapshots", () => {
    expect(validateAgentGroupStorageSnapshot({ version: 1 })).toBeNull();
    expect(
      validateAgentGroupStorageSnapshot({
        ...snapshot(),
        entries: { "foreign:theme": "dark" },
      }),
    ).toBeNull();
    expect(
      validateAgentGroupStorageSnapshot({
        ...snapshot(),
        entries: { "agent-group:large": "x".repeat(AGENT_GROUP_STORAGE_SNAPSHOT_MAX_BYTES) },
      }),
    ).toBeNull();
  });

  it("accepts renderer snapshots containing large composer drafts", () => {
    const largeDraft = "x".repeat(2 * 1024 * 1024);

    expect(
      validateAgentGroupStorageSnapshot({
        ...snapshot(),
        entries: { "agent-group:composer-drafts:v1": largeDraft },
      })?.entries["agent-group:composer-drafts:v1"],
    ).toBe(largeDraft);
  });

  it("does not replace a newer snapshot with an older export", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "agent-group-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await saveAgentGroupStorageSnapshot(target, snapshot("2026-07-09T01:00:00.000Z"));
      await expect(
        saveAgentGroupStorageSnapshot(target, snapshot("2026-07-09T00:00:00.000Z")),
      ).resolves.toBe(false);
      expect(readAgentGroupStorageSnapshot(target)?.exportedAt).toBe("2026-07-09T01:00:00.000Z");
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("treats missing and malformed files as absent", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "agent-group-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      expect(readAgentGroupStorageSnapshot(target)).toBeNull();
      FS.writeFileSync(target, "not json");
      expect(readAgentGroupStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
