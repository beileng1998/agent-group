import { DEFAULT_SERVER_SETTINGS, ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import { resolveTerminalTarget } from "./terminalAgentRuntimeResolution";

const threadId = ThreadId.makeUnsafe("deleted-terminal-thread");

function engineWithDeletedAt(input: {
  readonly threadDeletedAt: string | null;
  readonly projectDeletedAt: string | null;
}): OrchestrationEngineShape {
  return {
    getReadModel: () =>
      Effect.succeed({
        threads: [
          {
            id: threadId,
            projectId: "project-1",
            parentThreadId: undefined,
            modelSelection: { provider: "codex", model: "gpt-5" },
            runtimeMode: "approval-required",
            createdAt: "2026-07-25T00:00:00.000Z",
            deletedAt: input.threadDeletedAt,
          },
        ],
        projects: [
          {
            id: "project-1",
            workspaceRoot: "/workspace",
            deletedAt: input.projectDeletedAt,
          },
        ],
      } as never),
  } as unknown as OrchestrationEngineShape;
}

describe("terminal target resolution", () => {
  it("rejects new managed terminals on Windows", async () => {
    await expect(
      Effect.runPromise(
        resolveTerminalTarget({
          engine: engineWithDeletedAt({
            threadDeletedAt: null,
            projectDeletedAt: null,
          }),
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            providers: {
              ...DEFAULT_SERVER_SETTINGS.providers,
              codex: {
                ...DEFAULT_SERVER_SETTINGS.providers.codex,
                enabled: true,
              },
            },
          },
          threadId,
          platform: "win32",
        }),
      ),
    ).rejects.toMatchObject({ reason: "unsupported-provider" });
  });

  it.each([
    {
      threadDeletedAt: "2026-07-25T00:00:00.000Z",
      projectDeletedAt: null,
    },
    {
      threadDeletedAt: null,
      projectDeletedAt: "2026-07-25T00:00:00.000Z",
    },
  ])("rejects soft-deleted thread ownership", async (deletedAt) => {
    await expect(
      Effect.runPromise(
        resolveTerminalTarget({
          engine: engineWithDeletedAt(deletedAt),
          settings: DEFAULT_SERVER_SETTINGS,
          threadId,
          allowDisabled: true,
        }),
      ),
    ).rejects.toMatchObject({ reason: "thread-not-found" });
  });
});
