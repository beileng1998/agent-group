import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dismissAgentGroupAwarenessNotice,
  shouldShowAgentGroupAwarenessNotice,
} from "./agentGroupAwarenessNotice";

describe("agentGroupAwarenessNotice", () => {
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

  it("shows the explanation by default", () => {
    expect(shouldShowAgentGroupAwarenessNotice()).toBe(true);
  });

  it("remembers when the explanation is dismissed", () => {
    dismissAgentGroupAwarenessNotice();

    expect(shouldShowAgentGroupAwarenessNotice()).toBe(false);
  });
});
