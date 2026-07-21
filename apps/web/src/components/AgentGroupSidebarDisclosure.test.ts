import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  persistAgentGroupCollapsedSessionIds,
  readAgentGroupCollapsedSessionIds,
} from "./AgentGroupSidebarDisclosure";

describe("AgentGroupSidebarDisclosure", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to an empty collapsed set", () => {
    expect([...readAgentGroupCollapsedSessionIds()]).toEqual([]);
  });

  it("round-trips collapsed Session ids", () => {
    persistAgentGroupCollapsedSessionIds(new Set(["session-a", "session-b"]));

    expect([...readAgentGroupCollapsedSessionIds()]).toEqual(["session-a", "session-b"]);
  });

  it("ignores malformed and duplicate stored values", () => {
    window.localStorage.setItem(
      "agent-group:sidebar-session-disclosure:v1",
      JSON.stringify(["session-a", "", 42, "session-a", "session-b"]),
    );

    expect([...readAgentGroupCollapsedSessionIds()]).toEqual(["session-a", "session-b"]);
  });
});
