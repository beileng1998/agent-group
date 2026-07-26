import { TurnId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { terminalTurnIsInFlight } from "./terminalAgentLifecycleGuards";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

const readyAuthority = {
  adapter: "terminal",
  status: "ready",
  activeTurnId: null,
} as Parameters<typeof terminalTurnIsInFlight>[0];

describe("terminalTurnIsInFlight", () => {
  it("blocks switching for accepted and prepared terminal turns", () => {
    expect(
      terminalTurnIsInFlight(
        {
          ...readyAuthority,
          status: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        } as Parameters<typeof terminalTurnIsInFlight>[0],
        undefined,
      ),
    ).toBe(true);
    expect(
      terminalTurnIsInFlight(readyAuthority, {
        activeTurn: { accepted: false },
      } as TerminalAgentRuntimeRecord),
    ).toBe(true);
  });

  it("allows an idle terminal runtime to switch", () => {
    expect(
      terminalTurnIsInFlight(readyAuthority, {
        activeTurn: null,
      } as TerminalAgentRuntimeRecord),
    ).toBe(false);
  });
});
