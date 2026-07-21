import {
  DEFAULT_CLAUDE_MAX_TURNS,
  DEFAULT_CLAUDE_RESPONSE_IDLE_TIMEOUT_MS,
} from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { getProviderStartOptions } from "./appProviderOptions";
import { DEFAULT_APP_SETTINGS } from "./appSettingsSchema";
import { appSettingsPatchToServerSettingsPatch } from "./appSettingsServerSync";

describe("Claude runtime settings", () => {
  it("uses the guarded defaults when creating provider start options", () => {
    expect(getProviderStartOptions(DEFAULT_APP_SETTINGS)?.claudeAgent).toEqual({
      maxTurns: DEFAULT_CLAUDE_MAX_TURNS,
      responseIdleTimeoutMs: DEFAULT_CLAUDE_RESPONSE_IDLE_TIMEOUT_MS,
    });
  });

  it("syncs max turns and inactivity timeout to server settings", () => {
    expect(
      appSettingsPatchToServerSettingsPatch({
        claudeMaxTurns: 96,
        claudeResponseIdleTimeoutMs: 45 * 60_000,
      }),
    ).toEqual({
      providers: {
        claudeAgent: {
          maxTurns: 96,
          responseIdleTimeoutMs: 45 * 60_000,
        },
      },
    });
  });
});
