import { DEFAULT_CLAUDE_RESPONSE_IDLE_TIMEOUT_MS } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { getProviderStartOptions } from "./appProviderOptions";
import { DEFAULT_APP_SETTINGS } from "./appSettingsSchema";
import { appSettingsPatchToServerSettingsPatch } from "./appSettingsServerSync";

describe("Claude runtime settings", () => {
  it("leaves the turn limit disabled by default", () => {
    expect(getProviderStartOptions(DEFAULT_APP_SETTINGS)?.claudeAgent).toEqual({
      responseIdleTimeoutMs: DEFAULT_CLAUDE_RESPONSE_IDLE_TIMEOUT_MS,
    });
  });

  it("passes an explicitly enabled turn limit to Claude", () => {
    expect(
      getProviderStartOptions({
        ...DEFAULT_APP_SETTINGS,
        claudeMaxTurnsEnabled: true,
        claudeMaxTurns: 96,
      })?.claudeAgent,
    ).toEqual({
      maxTurns: 96,
      responseIdleTimeoutMs: DEFAULT_CLAUDE_RESPONSE_IDLE_TIMEOUT_MS,
    });
  });

  it("syncs the turn-limit toggle and inactivity timeout to server settings", () => {
    expect(
      appSettingsPatchToServerSettingsPatch({
        claudeMaxTurnsEnabled: true,
        claudeMaxTurns: 96,
        claudeResponseIdleTimeoutMs: 45 * 60_000,
      }),
    ).toEqual({
      providers: {
        claudeAgent: {
          maxTurnsEnabled: true,
          maxTurns: 96,
          responseIdleTimeoutMs: 45 * 60_000,
        },
      },
    });
  });
});
