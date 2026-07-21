import { Duration } from "effect";
import { describe, expect, it } from "vitest";

import { shouldRenewSessionCookie } from "./sessionCookie";

describe("session cookie renewal", () => {
  it("renews only inside the final seven days", () => {
    const nowMs = Date.parse("2026-07-19T00:00:00.000Z");

    expect(shouldRenewSessionCookie(nowMs + Duration.toMillis(Duration.days(8)), nowMs)).toBe(
      false,
    );
    expect(shouldRenewSessionCookie(nowMs + Duration.toMillis(Duration.days(7)), nowMs)).toBe(true);
    expect(shouldRenewSessionCookie(nowMs - 1, nowMs)).toBe(false);
  });
});
