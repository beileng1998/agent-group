import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureCodexInlineVisualizations,
  resolveCodexVisualizationArtifact,
} from "./codexVisualizations";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-group-visualization-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const sourceDirectory = path.join(
    workspaceRoot,
    ".codex",
    "visualizations",
    "2026",
    "07",
    "22",
    "thread-1",
  );
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(path.join(sourceDirectory, "status-map.html"), '<div id="map">ready</div>');
  return { stateDir, workspaceRoot };
}

describe("Codex visualization artifacts", () => {
  it("captures a strict thread-scoped fragment and resolves the durable copy", async () => {
    const fixture = await makeFixture();
    const captured = await captureCodexInlineVisualizations({
      ...fixture,
      threadId: "thread-1",
      messageId: "assistant:message-1",
      createdAt: "2026-07-22T08:00:00.000Z",
      text: 'Result\n\n::codex-inline-vis{file="status-map.html"}',
    });
    expect(captured).toHaveLength(1);

    const artifact = await resolveCodexVisualizationArtifact({
      stateDir: fixture.stateDir,
      threadId: "thread-1",
      messageId: "assistant:message-1",
      fileName: "status-map.html",
    });
    expect(artifact).not.toBeNull();
    expect(await readFile(artifact!.path, "utf8")).toBe('<div id="map">ready</div>');
  });

  it("rejects path traversal and unrelated thread directories", async () => {
    const fixture = await makeFixture();
    expect(
      await captureCodexInlineVisualizations({
        ...fixture,
        threadId: "thread-2",
        messageId: "assistant:message-2",
        createdAt: "2026-07-22T08:00:00.000Z",
        text: '::codex-inline-vis{file="status-map.html"}',
      }),
    ).toEqual([]);
    expect(
      await resolveCodexVisualizationArtifact({
        stateDir: fixture.stateDir,
        threadId: "thread-1",
        messageId: "assistant:message-1",
        fileName: "../status-map.html",
      }),
    ).toBeNull();
  });
});
