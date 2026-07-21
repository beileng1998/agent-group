import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CACHED_AGENT_GROUP_SESSION_READINESS,
  invalidateAgentGroupSessionReadiness,
  isAgentGroupSessionPrepared,
  prepareAgentGroupSession,
  resetAgentGroupSessionReadinessCacheForTests,
} from "./agentGroupSessionReadinessCache";

afterEach(() => {
  resetAgentGroupSessionReadinessCacheForTests();
  vi.restoreAllMocks();
});

describe("Agent Group Session readiness cache", () => {
  it("deduplicates in-flight preparation and reuses a successful result", async () => {
    let resolvePreparation: (() => void) | undefined;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePreparation = resolve;
        }),
    );

    const first = prepareAgentGroupSession("session-a", prepare);
    const second = prepareAgentGroupSession("session-a", prepare);

    expect(second).toBe(first);
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);
    resolvePreparation?.();
    await first;

    expect(isAgentGroupSessionPrepared("session-a")).toBe(true);
    await prepareAgentGroupSession("session-a", prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("removes failures so retry performs a new preparation", async () => {
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce();

    await expect(prepareAgentGroupSession("session-a", prepare)).rejects.toThrow("unavailable");
    await prepareAgentGroupSession("session-a", prepare);

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(isAgentGroupSessionPrepared("session-a")).toBe(true);
  });

  it("normalizes synchronous failures and allows retry", async () => {
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("invalid session");
      })
      .mockResolvedValueOnce();

    await expect(prepareAgentGroupSession("session-a", prepare)).rejects.toThrow("invalid session");
    await prepareAgentGroupSession("session-a", prepare);

    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("bounds successful readiness entries with LRU eviction", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);

    for (let index = 0; index < MAX_CACHED_AGENT_GROUP_SESSION_READINESS; index += 1) {
      await prepareAgentGroupSession(`session-${index}`, async () => undefined);
    }
    const cachedPrepare = vi.fn(async () => undefined);
    await prepareAgentGroupSession("session-0", cachedPrepare);
    await prepareAgentGroupSession(
      `session-${MAX_CACHED_AGENT_GROUP_SESSION_READINESS}`,
      async () => undefined,
    );

    expect(cachedPrepare).not.toHaveBeenCalled();
    expect(isAgentGroupSessionPrepared("session-0")).toBe(true);
    expect(isAgentGroupSessionPrepared("session-1")).toBe(false);
    expect(isAgentGroupSessionPrepared(`session-${MAX_CACHED_AGENT_GROUP_SESSION_READINESS}`)).toBe(
      true,
    );
  });

  it("supports explicit invalidation", async () => {
    await prepareAgentGroupSession("session-a", async () => undefined);
    invalidateAgentGroupSessionReadiness("session-a");
    expect(isAgentGroupSessionPrepared("session-a")).toBe(false);
  });
});
