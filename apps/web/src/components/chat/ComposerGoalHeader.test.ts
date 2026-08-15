import { describe, expect, it } from "vitest";

import { goalElapsedMs } from "./ComposerGoalHeader";

const startedAt = "2026-08-15T01:00:00.000Z";
const startedMs = Date.parse(startedAt);

describe("goalElapsedMs", () => {
  it("runs live, freezes while paused, and tolerates legacy goals", () => {
    expect(goalElapsedMs({ goalStartedAt: startedAt }, startedMs + 4_000)).toBe(4_000);
    expect(
      goalElapsedMs(
        { goalStartedAt: startedAt, goalPausedAt: "2026-08-15T01:00:11.000Z" },
        startedMs + 99_000,
      ),
    ).toBe(11_000);
    expect(goalElapsedMs({}, startedMs)).toBeNull();
  });
});
