import { GOAL_ACHIEVED_MARKER } from "@agent-group/shared/goalSettlement";
import { describe, expect, it } from "vitest";

import { buildPriorTranscriptBootstrapText } from "./handoff";

describe("goal settlement transcript bootstrap", () => {
  it("omits the internal marker from retained assistant context", () => {
    const bootstrap = buildPriorTranscriptBootstrapText(
      {
        title: "Goal thread",
        branch: null,
        worktreePath: null,
        messages: [
          {
            id: "assistant-goal",
            role: "assistant",
            source: "native",
            text: `Verified complete.\n${GOAL_ACHIEVED_MARKER}`,
            streaming: false,
          } as never,
        ],
      },
      undefined,
    );

    expect(bootstrap).toContain("Verified complete.");
    expect(bootstrap).not.toContain(GOAL_ACHIEVED_MARKER);
  });
});
