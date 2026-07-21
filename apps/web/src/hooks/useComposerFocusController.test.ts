import { describe, expect, it } from "vitest";

import { ThreadId } from "@agent-group/contracts";
import { shouldAutoFocusComposerOnThreadActivation } from "./useComposerFocusController";

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

function shouldAutoFocus(
  overrides: Partial<Parameters<typeof shouldAutoFocusComposerOnThreadActivation>[0]> = {},
): boolean {
  return shouldAutoFocusComposerOnThreadActivation({
    activeThreadId: THREAD_ID,
    inactiveSplitPane: false,
    terminalOpen: false,
    mobileViewport: false,
    coarsePointer: false,
    ...overrides,
  });
}

describe("shouldAutoFocusComposerOnThreadActivation", () => {
  it("keeps desktop thread activation focused for keyboard-first use", () => {
    expect(shouldAutoFocus()).toBe(true);
  });

  it("does not focus on mobile or touch-like devices", () => {
    expect(shouldAutoFocus({ mobileViewport: true })).toBe(false);
    expect(shouldAutoFocus({ coarsePointer: true })).toBe(false);
  });

  it("does not focus without an active chat composer", () => {
    expect(shouldAutoFocus({ activeThreadId: null })).toBe(false);
    expect(shouldAutoFocus({ inactiveSplitPane: true })).toBe(false);
    expect(shouldAutoFocus({ terminalOpen: true })).toBe(false);
  });
});
